"""Write unterminated-software-tag.tif: a 16x16 RGB uncompressed TIFF whose
`Software` tag is NOT NUL-terminated, the defect of the "Kruwo soft" camera
files reported 2026-10-15. libtiff reads such a file correctly but emits
`ASCII value for tag "Software" does not end in null byte`, a WARNING, which
sharp's default `failOn: 'warning'` turns into a failed decode.

Pure stdlib so it runs anywhere: python3 make_unterminated_ascii_tiff.py
"""
import struct
from pathlib import Path

W = H = 16
software = b"Kruwo soft"  # 10 bytes, count 10: deliberately no trailing NUL
pixels = b"".join(bytes((x * 16, y * 16, 128)) for y in range(H) for x in range(W))

entries = []  # (tag, type, count, value-or-offset placeholder)
n_entries = 11
ifd_offset = 8
ifd_size = 2 + n_entries * 12 + 4
bps_off = ifd_offset + ifd_size
sw_off = bps_off + 6
px_off = sw_off + len(software)

SHORT, LONG, ASCII = 3, 4, 2
entries = [
    (256, SHORT, 1, W),            # ImageWidth
    (257, SHORT, 1, H),            # ImageLength
    (258, SHORT, 3, bps_off),      # BitsPerSample 8,8,8
    (259, SHORT, 1, 1),            # Compression none
    (262, SHORT, 1, 2),            # Photometric RGB
    (273, LONG, 1, px_off),        # StripOffsets
    (277, SHORT, 1, 3),            # SamplesPerPixel
    (278, SHORT, 1, H),            # RowsPerStrip
    (279, LONG, 1, len(pixels)),   # StripByteCounts
    (284, SHORT, 1, 1),            # PlanarConfig contig
    (305, ASCII, len(software), sw_off),  # Software, unterminated
]
assert len(entries) == n_entries

out = bytearray(b"II*\x00" + struct.pack("<I", ifd_offset))
out += struct.pack("<H", n_entries)
for tag, typ, count, val in entries:
    if typ == SHORT and count == 1:
        out += struct.pack("<HHIHH", tag, typ, count, val, 0)
    else:
        out += struct.pack("<HHII", tag, typ, count, val)
out += struct.pack("<I", 0)
out += struct.pack("<HHH", 8, 8, 8)
out += software
out += pixels
Path(__file__).with_name("unterminated-software-tag.tif").write_bytes(out)
