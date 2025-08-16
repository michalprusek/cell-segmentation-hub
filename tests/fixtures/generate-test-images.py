#!/usr/bin/env python3
"""
Generate synthetic test images for SphereSeg testing.
Creates various types of cell-like images for comprehensive testing.
"""

import os
import sys
import json
import time
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import argparse
from pathlib import Path
import random

class TestImageGenerator:
    """Generates synthetic test images for cell segmentation testing."""
    
    def __init__(self, output_dir: str = "tests/fixtures/images"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        
        # Image parameters
        self.default_size = (512, 512)
        self.background_color = (30, 30, 30)  # Dark background
        self.cell_colors = [
            (180, 180, 180),  # Light gray
            (200, 200, 200),  # Lighter gray
            (160, 160, 160),  # Medium gray
        ]
        
    def create_circular_cell(self, center, radius, color, noise_level=0.1):
        """Create a circular cell-like shape with some randomness."""
        angles = np.linspace(0, 2*np.pi, 32)
        
        # Add some randomness to the radius
        radius_variation = np.random.normal(1, noise_level, len(angles))
        radii = radius * radius_variation
        
        # Calculate points
        points = []
        for i, angle in enumerate(angles):
            x = center[0] + radii[i] * np.cos(angle)
            y = center[1] + radii[i] * np.sin(angle)
            points.append((x, y))
            
        return points
    
    def create_elongated_cell(self, center, width, height, rotation=0, noise_level=0.1):
        """Create an elongated cell-like shape."""
        angles = np.linspace(0, 2*np.pi, 24)
        
        points = []
        for angle in angles:
            # Create elliptical shape
            local_x = width/2 * np.cos(angle)
            local_y = height/2 * np.sin(angle)
            
            # Apply rotation
            rot_x = local_x * np.cos(rotation) - local_y * np.sin(rotation)
            rot_y = local_x * np.sin(rotation) + local_y * np.cos(rotation)
            
            # Add noise
            noise_x = np.random.normal(0, noise_level * width/10)
            noise_y = np.random.normal(0, noise_level * height/10)
            
            x = center[0] + rot_x + noise_x
            y = center[1] + rot_y + noise_y
            points.append((x, y))
            
        return points
    
    def add_nucleus(self, draw, center, cell_radius, nucleus_color=(100, 100, 100)):
        """Add a nucleus inside a cell."""
        nucleus_radius = cell_radius * 0.3
        nucleus_center = (
            center[0] + random.uniform(-cell_radius*0.2, cell_radius*0.2),
            center[1] + random.uniform(-cell_radius*0.2, cell_radius*0.2)
        )
        
        # Create slightly irregular nucleus
        nucleus_points = self.create_circular_cell(
            nucleus_center, nucleus_radius, nucleus_color, noise_level=0.15
        )
        
        draw.polygon(nucleus_points, fill=nucleus_color)
    
    def add_noise_and_artifacts(self, image):
        """Add realistic microscopy noise and artifacts."""
        # Convert to numpy array
        img_array = np.array(image)
        
        # Add gaussian noise
        noise = np.random.normal(0, 5, img_array.shape)
        img_array = np.clip(img_array + noise, 0, 255)
        
        # Add some random bright spots (artifacts)
        height, width = img_array.shape[:2]
        for _ in range(random.randint(2, 8)):
            x = random.randint(0, width-1)
            y = random.randint(0, height-1)
            brightness = random.randint(200, 255)
            
            # Create small bright spot
            for dx in range(-2, 3):
                for dy in range(-2, 3):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < width and 0 <= ny < height:
                        distance = np.sqrt(dx*dx + dy*dy)
                        if distance <= 2:
                            factor = max(0, 1 - distance/2)
                            if len(img_array.shape) == 3:
                                img_array[ny, nx] = np.clip(
                                    img_array[ny, nx] + brightness * factor, 0, 255
                                )
                            else:
                                img_array[ny, nx] = min(255, img_array[ny, nx] + brightness * factor)
        
        return Image.fromarray(img_array.astype(np.uint8))
    
    def generate_sparse_cells_image(self, filename="sparse_cells.jpg"):
        """Generate an image with few, well-separated cells."""
        image = Image.new('RGB', self.default_size, self.background_color)
        draw = ImageDraw.Draw(image)
        
        cells_info = []
        
        # Generate 3-6 cells
        num_cells = random.randint(3, 6)
        for i in range(num_cells):
            # Ensure cells don't overlap
            valid_position = False
            attempts = 0
            while not valid_position and attempts < 50:
                center = (
                    random.randint(80, self.default_size[0] - 80),
                    random.randint(80, self.default_size[1] - 80)
                )
                
                # Check distance from existing cells
                valid_position = True
                for cell in cells_info:
                    distance = np.sqrt((center[0] - cell['center'][0])**2 + 
                                     (center[1] - cell['center'][1])**2)
                    if distance < (cell['radius'] + 50):
                        valid_position = False
                        break
                
                attempts += 1
            
            if valid_position:
                radius = random.randint(20, 40)
                color = random.choice(self.cell_colors)
                
                # Create cell shape
                cell_points = self.create_circular_cell(center, radius, color)
                draw.polygon(cell_points, fill=color, outline=None)
                
                # Add nucleus
                self.add_nucleus(draw, center, radius)
                
                cells_info.append({
                    'center': center,
                    'radius': radius,
                    'color': color
                })
        
        # Apply noise and artifacts
        image = self.add_noise_and_artifacts(image)
        
        # Save image
        filepath = self.output_dir / filename
        image.save(filepath, quality=90)
        print(f"✅ Generated {filename} with {len(cells_info)} cells")
        
        return str(filepath)
    
    def generate_dense_cells_image(self, filename="dense_cells.jpg"):
        """Generate an image with many overlapping cells."""
        image = Image.new('RGB', self.default_size, self.background_color)
        draw = ImageDraw.Draw(image)
        
        cells_info = []
        
        # Generate 15-25 cells
        num_cells = random.randint(15, 25)
        for i in range(num_cells):
            center = (
                random.randint(40, self.default_size[0] - 40),
                random.randint(40, self.default_size[1] - 40)
            )
            
            radius = random.randint(15, 35)
            color = random.choice(self.cell_colors)
            
            # Create cell shape
            cell_points = self.create_circular_cell(center, radius, color, noise_level=0.15)
            draw.polygon(cell_points, fill=color, outline=None)
            
            # Add nucleus (smaller for dense images)
            if random.random() > 0.3:  # Not all cells have visible nucleus
                self.add_nucleus(draw, center, radius)
            
            cells_info.append({
                'center': center,
                'radius': radius,
                'color': color
            })
        
        # Apply noise and artifacts
        image = self.add_noise_and_artifacts(image)
        
        # Save image
        filepath = self.output_dir / filename
        image.save(filepath, quality=90)
        print(f"✅ Generated {filename} with {len(cells_info)} cells")
        
        return str(filepath)
    
    def generate_elongated_cells_image(self, filename="elongated_cells.jpg"):
        """Generate an image with elongated cells."""
        image = Image.new('RGB', self.default_size, self.background_color)
        draw = ImageDraw.Draw(image)
        
        cells_info = []
        
        # Generate 8-12 elongated cells
        num_cells = random.randint(8, 12)
        for i in range(num_cells):
            center = (
                random.randint(60, self.default_size[0] - 60),
                random.randint(60, self.default_size[1] - 60)
            )
            
            width = random.randint(60, 100)
            height = random.randint(20, 40)
            rotation = random.uniform(0, 2*np.pi)
            color = random.choice(self.cell_colors)
            
            # Create elongated cell shape
            cell_points = self.create_elongated_cell(center, width, height, rotation, noise_level=0.1)
            draw.polygon(cell_points, fill=color, outline=None)
            
            # Add nucleus
            if random.random() > 0.2:
                self.add_nucleus(draw, center, min(width, height)/4)
            
            cells_info.append({
                'center': center,
                'width': width,
                'height': height,
                'rotation': rotation,
                'color': color
            })
        
        # Apply noise and artifacts
        image = self.add_noise_and_artifacts(image)
        
        # Save image
        filepath = self.output_dir / filename
        image.save(filepath, quality=90)
        print(f"✅ Generated {filename} with {len(cells_info)} elongated cells")
        
        return str(filepath)
    
    def generate_poor_quality_image(self, filename="poor_quality.jpg"):
        """Generate a poor quality image for testing error handling."""
        image = Image.new('RGB', self.default_size, self.background_color)
        draw = ImageDraw.Draw(image)
        
        # Add a few barely visible cells
        for i in range(3):
            center = (
                random.randint(100, self.default_size[0] - 100),
                random.randint(100, self.default_size[1] - 100)
            )
            
            radius = random.randint(20, 30)
            # Very low contrast color
            color = (50, 50, 50)
            
            cell_points = self.create_circular_cell(center, radius, color, noise_level=0.3)
            draw.polygon(cell_points, fill=color, outline=None)
        
        # Apply heavy noise
        img_array = np.array(image)
        heavy_noise = np.random.normal(0, 20, img_array.shape)
        img_array = np.clip(img_array + heavy_noise, 0, 255)
        image = Image.fromarray(img_array.astype(np.uint8))
        
        # Apply blur
        image = image.filter(ImageFilter.GaussianBlur(radius=2))
        
        # Save with low quality
        filepath = self.output_dir / filename
        image.save(filepath, quality=30)
        print(f"⚠️ Generated {filename} (poor quality)")
        
        return str(filepath)
    
    def generate_edge_cells_image(self, filename="edge_cells.jpg"):
        """Generate an image with cells at the edges."""
        image = Image.new('RGB', self.default_size, self.background_color)
        draw = ImageDraw.Draw(image)
        
        cells_info = []
        
        # Generate cells near edges
        edge_positions = [
            (30, random.randint(50, self.default_size[1] - 50)),  # Left edge
            (self.default_size[0] - 30, random.randint(50, self.default_size[1] - 50)),  # Right edge
            (random.randint(50, self.default_size[0] - 50), 30),  # Top edge
            (random.randint(50, self.default_size[0] - 50), self.default_size[1] - 30),  # Bottom edge
        ]
        
        # Add a few cells in the center too
        center_positions = [
            (self.default_size[0]//2 + random.randint(-50, 50), 
             self.default_size[1]//2 + random.randint(-50, 50))
            for _ in range(3)
        ]
        
        all_positions = edge_positions + center_positions
        
        for center in all_positions:
            radius = random.randint(25, 40)
            color = random.choice(self.cell_colors)
            
            cell_points = self.create_circular_cell(center, radius, color)
            draw.polygon(cell_points, fill=color, outline=None)
            
            # Add nucleus
            self.add_nucleus(draw, center, radius)
            
            cells_info.append({
                'center': center,
                'radius': radius,
                'color': color
            })
        
        # Apply noise and artifacts
        image = self.add_noise_and_artifacts(image)
        
        # Save image
        filepath = self.output_dir / filename
        image.save(filepath, quality=90)
        print(f"✅ Generated {filename} with {len(cells_info)} cells (including edge cases)")
        
        return str(filepath)
    
    def generate_different_sizes_image(self, filename="different_sizes.jpg"):
        """Generate an image with cells of very different sizes."""
        image = Image.new('RGB', self.default_size, self.background_color)
        draw = ImageDraw.Draw(image)
        
        cells_info = []
        
        # Generate cells with varying sizes
        cell_configs = [
            {'radius': 60, 'count': 2},   # Large cells
            {'radius': 30, 'count': 5},   # Medium cells
            {'radius': 15, 'count': 8},   # Small cells
            {'radius': 8, 'count': 12},   # Very small cells
        ]
        
        for config in cell_configs:
            for _ in range(config['count']):
                attempts = 0
                valid_position = False
                
                while not valid_position and attempts < 30:
                    margin = config['radius'] + 10
                    center = (
                        random.randint(margin, self.default_size[0] - margin),
                        random.randint(margin, self.default_size[1] - margin)
                    )
                    
                    # Check for minimal overlap with existing cells
                    valid_position = True
                    for cell in cells_info:
                        distance = np.sqrt((center[0] - cell['center'][0])**2 + 
                                         (center[1] - cell['center'][1])**2)
                        min_distance = (cell['radius'] + config['radius']) * 0.7
                        if distance < min_distance:
                            valid_position = False
                            break
                    
                    attempts += 1
                
                if valid_position:
                    color = random.choice(self.cell_colors)
                    
                    cell_points = self.create_circular_cell(
                        center, config['radius'], color, 
                        noise_level=0.05 if config['radius'] > 20 else 0.2
                    )
                    draw.polygon(cell_points, fill=color, outline=None)
                    
                    # Add nucleus only to larger cells
                    if config['radius'] > 15 and random.random() > 0.3:
                        self.add_nucleus(draw, center, config['radius'])
                    
                    cells_info.append({
                        'center': center,
                        'radius': config['radius'],
                        'color': color
                    })
        
        # Apply noise and artifacts
        image = self.add_noise_and_artifacts(image)
        
        # Save image
        filepath = self.output_dir / filename
        image.save(filepath, quality=90)
        print(f"✅ Generated {filename} with {len(cells_info)} cells of varying sizes")
        
        return str(filepath)
    
    def generate_all_test_images(self, count=1):
        """Generate all test image types."""
        generated_files = []
        
        print("🖼️ Generating test images for SphereSeg...")
        
        generated_files.append(self.generate_sparse_cells_image())
        generated_files.append(self.generate_dense_cells_image())
        generated_files.append(self.generate_elongated_cells_image())
        generated_files.append(self.generate_edge_cells_image())
        generated_files.append(self.generate_different_sizes_image())
        generated_files.append(self.generate_poor_quality_image())
        
        # Generate additional variants based on count
        for i in range(count - 1 if count > 1 else 2):
            generated_files.append(
                self.generate_sparse_cells_image(f"sparse_cells_variant_{i+1}.jpg")
            )
            generated_files.append(
                self.generate_dense_cells_image(f"dense_cells_variant_{i+1}.jpg")
            )
        
        print(f"\n✅ Generated {len(generated_files)} test images")
        print(f"📁 Images saved to: {self.output_dir}")
        
        # Generate a manifest file
        manifest = {
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total_images": len(generated_files),
            "image_size": self.default_size,
            "files": generated_files,
            "categories": {
                "sparse": [f for f in generated_files if "sparse" in f],
                "dense": [f for f in generated_files if "dense" in f],
                "elongated": [f for f in generated_files if "elongated" in f],
                "edge_cases": [f for f in generated_files if "edge" in f],
                "size_variants": [f for f in generated_files if "different_sizes" in f],
                "poor_quality": [f for f in generated_files if "poor_quality" in f]
            }
        }
        
        manifest_file = self.output_dir / "test_images_manifest.json"
        with open(manifest_file, 'w') as f:
            json.dump(manifest, f, indent=2)
        
        print(f"📋 Manifest saved to: {manifest_file}")
        
        return generated_files


def main():
    parser = argparse.ArgumentParser(description="Generate synthetic test images for SphereSeg")
    parser.add_argument("--output", "-o", default="tests/fixtures/images",
                       help="Output directory for test images")
    parser.add_argument("--count", "-c", type=int, default=1,
                       help="Number of each image type to generate")
    
    args = parser.parse_args()
    
    generator = TestImageGenerator(args.output)
    generated_files = generator.generate_all_test_images(args.count)
    
    print(f"\n🎉 Test image generation complete!")
    print(f"Generated {len(generated_files)} images in {args.output}")


if __name__ == "__main__":
    main()