package ij.plugin.frame;

import ij.ImagePlus;
import ij.WindowManager;
import ij.process.ByteProcessor;
import ij.process.ImageProcessor;
import ij.process.ImageStatistics;
import ij.process.ShortProcessor;
import ij.process.ShortStatistics;
import ij.IJ;
import java.awt.Color;
import java.awt.Scrollbar;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;

/**
 * Runs ImageJ's OWN Brightness & Contrast code on a raw sample file and prints
 * what it computed, as one JSON object on stdout.
 *
 * WHY IT IS IN THIS PACKAGE. `ContrastPlot`, `ContrastAdjuster.autoAdjust` and
 * the fields they read are package-private. Declaring this class in
 * `ij.plugin.frame` is what lets it call them directly, so the expected values
 * in the editor's histogram tests come from ImageJ executing, not from a second
 * transcription of it that could share a misreading with the first.
 *
 * WHY Unsafe. `ContrastAdjuster` is a dialog and its constructor builds AWT
 * widgets, which throw HeadlessException on a server. `allocateInstance` gives
 * an instance without running it; `autoAdjust` then only touches the fields set
 * below, plus the brightness scrollbar it updates without a null check.
 *
 * Usage (see run.mjs, which builds and drives it):
 *   java -cp ij.jar:. ij.plugin.frame.HistogramOracle \
 *     <raw file> <width> <height> <8|16> <auto clicks> [lo hi]...
 * 16-bit files are little-endian. Each trailing (lo, hi) pair is an explicit
 * histogram range, binned by ShortStatistics exactly as ImageJ bins one.
 */
public class HistogramOracle {

  public static void main(String[] args) throws Exception {
    String path = args[0];
    int width = Integer.parseInt(args[1]);
    int height = Integer.parseInt(args[2]);
    int bitDepth = Integer.parseInt(args[3]);
    int clicks = Integer.parseInt(args[4]);
    int n = width * height;

    byte[] bytes = Files.readAllBytes(Paths.get(path));
    ImageProcessor ip;
    ShortProcessor asShort;
    if (bitDepth == 16) {
      short[] px = new short[n];
      ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(px);
      ip = new ShortProcessor(width, height, px, null);
      asShort = (ShortProcessor) ip.duplicate();
    } else {
      ip = new ByteProcessor(width, height, Arrays.copyOf(bytes, n), null);
      // Same values in a 16-bit container: ByteStatistics ignores a histogram
      // range, ShortStatistics honours one, and the range binning is the thing
      // being asked about.
      asShort = (ShortProcessor) ip.convertToShort(false);
    }
    ImagePlus imp = new ImagePlus("oracle", ip);
    WindowManager.setTempCurrentImage(imp);

    StringBuilder out = new StringBuilder();
    out.append("{\"imagejVersion\":\"").append(IJ.getVersion()).append('"');
    out.append(",\"raw\":").append(stats(imp.getRawStatistics()));
    out.append(",\"rawCeiling\":").append(ceiling(imp.getRawStatistics()));

    out.append(",\"axes\":[");
    for (int a = 5; a + 1 < args.length; a += 2) {
      double lo = Double.parseDouble(args[a]);
      double hi = Double.parseDouble(args[a + 1]);
      if (a > 5) out.append(',');
      out.append("{\"range\":[").append(num(lo)).append(',').append(num(hi)).append("]");
      out.append(",\"stats\":").append(stats(rangeStats(asShort, lo, hi)));
      out.append(",\"ceiling\":").append(ceiling(rangeStats(asShort, lo, hi)));
      out.append('}');
    }
    out.append(']');

    out.append(",\"auto\":").append(autoClicks(imp, bitDepth, clicks));
    out.append('}');
    System.out.println(out);
  }

  static ImageStatistics rangeStats(ShortProcessor sp, double lo, double hi) {
    sp.setHistogramRange(lo, hi);
    return new ShortStatistics(
        sp, ImageStatistics.AREA | ImageStatistics.MIN_MAX | ImageStatistics.MODE, null);
  }

  /** ContrastPlot.setHistogram's y ceiling. It writes into the array, so the
   *  caller hands it a fresh statistics object every time. */
  static String ceiling(ImageStatistics s) throws Exception {
    ContrastPlot plot = (ContrastPlot) unsafe().allocateInstance(ContrastPlot.class);
    setHistogram(plot, s);
    return "{\"hmax\":" + plot.hmax + ",\"drawn\":" + ints(plot.histogram) + "}";
  }

  /** The signature changed in 1.54q21 (2025-08-28), when the bars became
   *  LUT-coloured and a log-scale option arrived: up to then the second
   *  argument was the bar Color, since then it is the log flag. The ceiling
   *  rule this oracle reads is the same code in both, so either jar will do;
   *  reflection lets one source build against both. */
  static void setHistogram(ContrastPlot plot, ImageStatistics s) throws Exception {
    for (Method m : ContrastPlot.class.getDeclaredMethods()) {
      if (!m.getName().equals("setHistogram") || m.getParameterCount() != 2) continue;
      m.setAccessible(true);
      Class<?> second = m.getParameterTypes()[1];
      if (second == boolean.class) {
        m.invoke(plot, s, false);
        return;
      }
      if (second == Color.class) {
        m.invoke(plot, s, Color.gray);
        return;
      }
    }
    throw new IllegalStateException("no known ContrastPlot.setHistogram signature");
  }

  static String autoClicks(ImagePlus imp, int bitDepth, int clicks) throws Exception {
    ContrastAdjuster ca = (ContrastAdjuster) unsafe().allocateInstance(ContrastAdjuster.class);
    ca.plot = (ContrastPlot) unsafe().allocateInstance(ContrastPlot.class);
    ca.brightnessSlider = (Scrollbar) unsafe().allocateInstance(Scrollbar.class);
    ca.sliderRange = 256;
    ca.channels = 7;
    // setupNewImage's defaults, which updateScrollBars divides by.
    ImageStatistics s0 = imp.getRawStatistics();
    ca.defaultMin = bitDepth == 16 ? s0.min : 0;
    ca.defaultMax = bitDepth == 16 ? s0.max : 255;
    ca.plot.defaultMin = ca.defaultMin;
    ca.plot.defaultMax = ca.defaultMax;
    imp.resetDisplayRange();

    StringBuilder sb = new StringBuilder("[");
    for (int k = 0; k < clicks; k++) {
      String error = null;
      try {
        ca.autoAdjust(imp, imp.getProcessor());
      } catch (Throwable t) {
        error = t.toString();
      }
      if (k > 0) sb.append(',');
      sb.append("{\"displayMin\":").append(num(imp.getDisplayRangeMin()));
      sb.append(",\"displayMax\":").append(num(imp.getDisplayRangeMax()));
      sb.append(",\"min\":").append(num(ca.min));
      sb.append(",\"max\":").append(num(ca.max));
      sb.append(",\"autoThreshold\":").append(ca.autoThreshold);
      sb.append(",\"error\":").append(error == null ? "null" : "\"" + error.replace("\"", "'") + "\"");
      sb.append('}');
    }
    return sb.append(']').toString();
  }

  static String stats(ImageStatistics s) {
    return "{\"histogram\":" + ints(s.histogram)
        + ",\"nBins\":" + s.nBins
        + ",\"histMin\":" + num(s.histMin)
        + ",\"histMax\":" + num(s.histMax)
        + ",\"binSize\":" + num(s.binSize)
        + ",\"pixelCount\":" + s.pixelCount
        + ",\"min\":" + num(s.min)
        + ",\"max\":" + num(s.max)
        + ",\"maxCount\":" + s.maxCount + "}";
  }

  static String ints(int[] a) {
    if (a == null) return "null";
    StringBuilder sb = new StringBuilder("[");
    for (int i = 0; i < a.length; i++) {
      if (i > 0) sb.append(',');
      sb.append(a[i]);
    }
    return sb.append(']').toString();
  }

  static String num(double d) {
    return Double.isFinite(d) ? Double.toString(d) : "null";
  }

  static sun.misc.Unsafe unsafe() throws Exception {
    Field f = sun.misc.Unsafe.class.getDeclaredField("theUnsafe");
    f.setAccessible(true);
    return (sun.misc.Unsafe) f.get(null);
  }
}
