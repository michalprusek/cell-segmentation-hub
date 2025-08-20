#!/usr/bin/env python3
"""
Test Image Generator for E2E Tests
Creates realistic test images for different scenarios
"""

import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import argparse
import json
import datetime

class TestImageGenerator:
    def __init__(self, output_dir: str):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
    def create_cell_microscopy_image(self, 
                                   filename: str,
                                   width: int = 1024,
                                   height: int = 1024,
                                   num_cells: int = 20,
                                   cell_size_range: tuple = (20, 80),
                                   background_intensity: int = 30) -> Path:
        """Create a realistic cell microscopy image"""
        
        # Create base image with slight gradient background
        image = np.zeros((height, width), dtype=np.uint8)
        
        # Add gradient background
        for i in range(height):
            for j in range(width):
                gradient = background_intensity + int(10 * np.sin(i/100) * np.cos(j/100))
                image[i, j] = max(0, min(255, gradient + np.random.randint(-10, 10)))
        
        # Add cells
        for _ in range(num_cells):
            # Random cell position
            cx = np.random.randint(50, width - 50)
            cy = np.random.randint(50, height - 50)
            
            # Random cell size
            radius = np.random.randint(*cell_size_range)
            
            # Cell intensity
            cell_intensity = np.random.randint(150, 220)
            
            # Create circular cell with some irregular boundary
            y, x = np.ogrid[:height, :width]
            
            # Add some irregularity to cell shape
            angles = np.linspace(0, 2*np.pi, 36)
            radius_variation = radius * (1 + 0.2 * np.sin(6 * angles) + 0.1 * np.random.randn(36))
            
            # Create mask for irregular cell
            for i, angle in enumerate(angles):
                r = radius_variation[i]
                x_offset = int(r * np.cos(angle))
                y_offset = int(r * np.sin(angle))
                
                # Draw small circles to create irregular boundary
                mask = (x - (cx + x_offset))**2 + (y - (cy + y_offset))**2 <= (r/4)**2
                image[mask] = cell_intensity + np.random.randint(-20, 20)
            
            # Add nucleus (darker region in center)
            nucleus_mask = (x - cx)**2 + (y - cy)**2 <= (radius * 0.4)**2
            nucleus_intensity = cell_intensity - 50
            image[nucleus_mask] = max(0, nucleus_intensity + np.random.randint(-15, 15))
        
        # Add noise
        noise = np.random.normal(0, 5, (height, width))
        image = np.clip(image + noise, 0, 255).astype(np.uint8)
        
        # Apply slight blur to simulate microscopy
        pil_image = Image.fromarray(image, 'L')
        pil_image = pil_image.filter(ImageFilter.GaussianBlur(radius=0.5))
        
        output_path = self.output_dir / filename
        pil_image.save(output_path)
        return output_path
    
    def create_tissue_histology_image(self,
                                    filename: str,
                                    width: int = 1024,
                                    height: int = 1024,
                                    num_structures: int = 8) -> Path:
        """Create a histology tissue image"""
        
        # Create RGB image for H&E staining simulation
        image = np.zeros((height, width, 3), dtype=np.uint8)
        
        # Base tissue background (pink/purple for H&E)
        background_color = [180, 120, 150]  # Pink base
        for i in range(3):
            image[:, :, i] = background_color[i] + np.random.randint(-30, 30, (height, width))
        
        # Add tissue structures
        for _ in range(num_structures):
            # Random structure position and size
            cx = np.random.randint(100, width - 100)
            cy = np.random.randint(100, height - 100)
            
            # Create irregular tissue structure
            structure_width = np.random.randint(50, 150)
            structure_height = np.random.randint(50, 150)
            
            # Structure color (darker purple/blue for nuclei-rich areas)
            structure_color = [100, 80, 180]  # Purple-blue
            
            # Create elliptical structure with irregular boundaries
            y, x = np.ogrid[:height, :width]
            ellipse_mask = ((x - cx) / structure_width)**2 + ((y - cy) / structure_height)**2 <= 1
            
            # Add irregularity
            irregularity = np.sin(6 * np.arctan2(y - cy, x - cx)) * 0.3
            ellipse_mask = ellipse_mask & (((x - cx) / structure_width)**2 + ((y - cy) / structure_height)**2 <= 1 + irregularity)
            
            for i in range(3):
                image[ellipse_mask, i] = structure_color[i] + np.random.randint(-20, 20)
        
        # Add blood vessels (red channels)
        for _ in range(3):
            start_x = np.random.randint(0, width)
            start_y = np.random.randint(0, height)
            end_x = np.random.randint(0, width)
            end_y = np.random.randint(0, height)
            
            # Create vessel path
            num_points = 50
            x_path = np.linspace(start_x, end_x, num_points)
            y_path = np.linspace(start_y, end_y, num_points)
            
            # Add some curvature
            for i in range(1, num_points - 1):
                x_path[i] += np.sin(i * 0.5) * 20
                y_path[i] += np.cos(i * 0.5) * 15
            
            # Draw vessel
            vessel_thickness = np.random.randint(5, 15)
            for i, (x, y) in enumerate(zip(x_path, y_path)):
                if 0 <= x < width and 0 <= y < height:
                    y, x = np.ogrid[:height, :width]
                    vessel_mask = (x - int(x_path[i]))**2 + (y - int(y_path[i]))**2 <= vessel_thickness**2
                    image[vessel_mask, 0] = 200  # Red channel
                    image[vessel_mask, 1] = 50   # Low green
                    image[vessel_mask, 2] = 50   # Low blue
        
        # Add noise and convert to PIL
        noise = np.random.normal(0, 3, image.shape)
        image = np.clip(image + noise, 0, 255).astype(np.uint8)
        
        pil_image = Image.fromarray(image, 'RGB')
        pil_image = pil_image.filter(ImageFilter.GaussianBlur(radius=0.3))
        
        output_path = self.output_dir / filename
        pil_image.save(output_path)
        return output_path
    
    def create_bacteria_colony_image(self,
                                   filename: str,
                                   width: int = 1024,
                                   height: int = 1024,
                                   num_colonies: int = 15) -> Path:
        """Create bacterial colony counting image"""
        
        # Create petri dish background (light beige)
        image = np.full((height, width, 3), [240, 235, 220], dtype=np.uint8)
        
        # Add petri dish circular boundary
        center_x, center_y = width // 2, height // 2
        radius = min(width, height) // 2 - 20
        
        y, x = np.ogrid[:height, :width]
        petri_mask = (x - center_x)**2 + (y - center_y)**2 <= radius**2
        
        # Darken outside petri dish
        image[~petri_mask] = [200, 195, 180]
        
        # Add colonies within petri dish
        for _ in range(num_colonies):
            # Random colony position within petri dish
            angle = np.random.uniform(0, 2 * np.pi)
            distance = np.random.uniform(0, radius * 0.8)
            
            colony_x = int(center_x + distance * np.cos(angle))
            colony_y = int(center_y + distance * np.sin(angle))
            
            # Colony size and color
            colony_radius = np.random.randint(8, 25)
            colony_color = [
                np.random.randint(180, 220),  # Light color
                np.random.randint(160, 200),
                np.random.randint(140, 180)
            ]
            
            # Create colony with some transparency effect
            colony_mask = (x - colony_x)**2 + (y - colony_y)**2 <= colony_radius**2
            
            # Add edge effect (slightly darker edge)
            edge_mask = ((x - colony_x)**2 + (y - colony_y)**2 <= colony_radius**2) & \
                       ((x - colony_x)**2 + (y - colony_y)**2 > (colony_radius * 0.7)**2)
            
            # Apply colony color
            for i in range(3):
                image[colony_mask, i] = colony_color[i]
                image[edge_mask, i] = max(0, colony_color[i] - 30)
        
        # Add some agar medium texture
        texture_noise = np.random.normal(0, 2, image.shape)
        image = np.clip(image + texture_noise, 0, 255).astype(np.uint8)
        
        pil_image = Image.fromarray(image, 'RGB')
        pil_image = pil_image.filter(ImageFilter.GaussianBlur(radius=0.2))
        
        output_path = self.output_dir / filename
        pil_image.save(output_path)
        return output_path
    
    def create_test_image_set(self) -> dict:
        """Create a complete set of test images"""
        
        created_images = {}
        
        # Microscopy cell images
        for i in range(5):
            filename = f'test-cells-{i+1:03d}.jpg'
            path = self.create_cell_microscopy_image(
                filename,
                num_cells=np.random.randint(10, 30),
                cell_size_range=(15, 60)
            )
            created_images[f'cells_{i+1}'] = str(path)
        
        # Histology tissue images
        for i in range(3):
            filename = f'test-tissue-{i+1:03d}.jpg'
            path = self.create_tissue_histology_image(
                filename,
                num_structures=np.random.randint(5, 12)
            )
            created_images[f'tissue_{i+1}'] = str(path)
        
        # Bacterial colony images
        for i in range(3):
            filename = f'test-bacteria-{i+1:03d}.jpg'
            path = self.create_bacteria_colony_image(
                filename,
                num_colonies=np.random.randint(8, 20)
            )
            created_images[f'bacteria_{i+1}'] = str(path)
        
        # Create different sizes for testing
        sizes = [(512, 512), (2048, 2048), (1536, 1024)]
        for i, (w, h) in enumerate(sizes):
            filename = f'test-size-{w}x{h}.jpg'
            path = self.create_cell_microscopy_image(
                filename, width=w, height=h, num_cells=int((w * h) / 50000)
            )
            created_images[f'size_{w}x{h}'] = str(path)
        
        return created_images
    
    def create_corrupted_files(self) -> dict:
        """Create files for error testing"""
        
        corrupted_files = {}
        
        # Empty file
        empty_file = self.output_dir / 'corrupted-empty.jpg'
        empty_file.write_bytes(b'')
        corrupted_files['empty'] = str(empty_file)
        
        # File with wrong extension
        text_file = self.output_dir / 'not-an-image.jpg'
        text_file.write_text('This is not an image file')
        corrupted_files['wrong_content'] = str(text_file)
        
        # Truncated image file
        valid_image = Image.new('RGB', (100, 100), color='red')
        truncated_file = self.output_dir / 'truncated.jpg'
        valid_image.save(truncated_file, quality=95)
        
        # Truncate the file
        with open(truncated_file, 'r+b') as f:
            f.seek(0, 2)  # Seek to end of file
            file_size = f.tell()
            f.truncate(file_size // 2)
        
        corrupted_files['truncated'] = str(truncated_file)
        
        return corrupted_files
    
    def create_large_files(self) -> dict:
        """Create large files for testing upload limits"""
        
        large_files = {}
        
        # Create 50MB image
        large_image = self.create_cell_microscopy_image(
            'large-50mb.tiff',
            width=4096,
            height=4096,
            num_cells=200
        )
        large_files['50mb'] = str(large_image)
        
        return large_files


def main():
    parser = argparse.ArgumentParser(description='Generate test images for E2E tests')
    parser.add_argument('--output-dir', '-o', default='./test-images',
                        help='Output directory for generated images')
    parser.add_argument('--set', '-s', choices=['basic', 'complete', 'error', 'large'],
                        default='basic', help='Image set to generate')
    parser.add_argument('--manifest', '-m', action='store_true',
                        help='Generate manifest file with image metadata')
    
    args = parser.parse_args()
    
    generator = TestImageGenerator(args.output_dir)
    
    if args.set == 'basic':
        # Generate basic test images
        images = {}
        images.update({
            'cell_basic': str(generator.create_cell_microscopy_image('test-image.jpg')),
            'tissue_basic': str(generator.create_tissue_histology_image('test-tissue.jpg')),
            'bacteria_basic': str(generator.create_bacteria_colony_image('test-bacteria.jpg')),
        })
    elif args.set == 'complete':
        images = generator.create_test_image_set()
    elif args.set == 'error':
        images = generator.create_corrupted_files()
    elif args.set == 'large':
        images = generator.create_large_files()
    
    print(f"Generated {len(images)} test images in {args.output_dir}")
    
    if args.manifest:
        manifest_file = Path(args.output_dir) / 'manifest.json'
        with open(manifest_file, 'w') as f:
            json.dump({
                'generated_at': datetime.datetime.now().isoformat(),
                'image_set': args.set,
                'images': images,
                'count': len(images)
            }, f, indent=2)
        print(f"Manifest written to {manifest_file}")
    
    # List generated files
    for name, path in images.items():
        file_size = Path(path).stat().st_size if Path(path).exists() else 0
        print(f"  {name}: {Path(path).name} ({file_size:,} bytes)")


if __name__ == '__main__':
    main()