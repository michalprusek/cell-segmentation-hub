import { Area } from 'react-easy-crop';

/**
 * Creates a cropped image from canvas and returns as blob
 */
export const createCroppedImage = async (
  imageSrc: string,
  pixelCrop: Area,
  flip = { horizontal: false, vertical: false },
  rotation = 0
): Promise<Blob> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not create canvas context');
  }

  const rotRad = getRadianAngle(rotation);

  // Calculate bounding box of the rotated image
  const { width: bBoxWidth, height: bBoxHeight } = rotateSize(
    image.width,
    image.height,
    rotation
  );

  // Set canvas size to match the crop area
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;

  // Translate canvas context to the center of the crop area
  ctx.translate(pixelCrop.width / 2, pixelCrop.height / 2);
  ctx.rotate(rotRad);
  ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);

  // Calculate the correct offset for the image relative to the crop center
  // This accounts for the rotation pivot point being at the image center
  const offsetX = -(pixelCrop.x + pixelCrop.width / 2);
  const offsetY = -(pixelCrop.y + pixelCrop.height / 2);
  ctx.translate(offsetX, offsetY);

  // Draw the full image (drawImage will clip to canvas bounds)
  ctx.drawImage(image, 0, 0, image.width, image.height);

  // Return canvas as blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      },
      'image/jpeg',
      0.95
    );
  });
};

/**
 * Simplified crop function for circular avatars
 */
export const cropImageToCircle = async (
  imageSrc: string,
  pixelCrop: Area
): Promise<Blob> => {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not create canvas context');
  }

  // Set canvas to square dimensions for circular crop
  const size = Math.min(pixelCrop.width, pixelCrop.height);
  canvas.width = size;
  canvas.height = size;

  // Create circular clipping path
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();

  // Draw the cropped portion of the image
  const sourceX = pixelCrop.x + (pixelCrop.width - size) / 2;
  const sourceY = pixelCrop.y + (pixelCrop.height - size) / 2;

  ctx.drawImage(image, sourceX, sourceY, size, size, 0, 0, size, size);

  ctx.restore();

  // Return canvas as blob
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      blob => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob from canvas'));
        }
      },
      'image/jpeg',
      0.95
    );
  });
};

/**
 * Create image element from source
 */
const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', error => {
      // Handle CORS errors specifically
      const corsError = new Error(
        error instanceof Event && error.type === 'error'
          ? 'Failed to load image. This may be due to CORS restrictions.'
          : 'Failed to load image'
      );
      reject(corsError);
    });
    image.setAttribute('crossOrigin', 'anonymous'); // Needed to avoid canvas taint
    image.src = url;
  });

/**
 * Convert degrees to radians
 */
const getRadianAngle = (degreeValue: number): number => {
  return (degreeValue * Math.PI) / 180;
};

/**
 * Calculate size of rotated image
 */
const rotateSize = (width: number, height: number, rotation: number) => {
  const rotRad = getRadianAngle(rotation);

  return {
    width:
      Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
    height:
      Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
  };
};

/**
 * Convert blob to base64 string
 */
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
