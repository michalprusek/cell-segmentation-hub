"""Helper utilities for segmentation microservice"""

import logging
import math
import mimetypes
import re
import time
from typing import Optional
from fastapi import UploadFile

logger = logging.getLogger(__name__)

def validate_image(file: UploadFile) -> bool:
    """
    Validate uploaded image file
    
    Args:
        file: FastAPI UploadFile object
        
    Returns:
        True if valid image, False otherwise
    """
    try:
        # Check file size (max 50MB)
        if hasattr(file, 'size') and file.size:
            if file.size > 50 * 1024 * 1024:  # 50MB limit
                logger.warning(f"File too large: {file.size} bytes")
                return False
        
        # Check content type
        if file.content_type:
            if not file.content_type.startswith('image/'):
                logger.warning(f"Invalid content type: {file.content_type}")
                return False
        
        # Check file extension
        if file.filename:
            # Get MIME type from filename
            mime_type, _ = mimetypes.guess_type(file.filename)
            if mime_type and not mime_type.startswith('image/'):
                logger.warning(f"Invalid file type for {file.filename}: {mime_type}")
                return False
            
            # Check allowed extensions - safe file extension extraction
            allowed_extensions = {'.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp'}
            filename_parts = file.filename.lower().split('.')
            if len(filename_parts) < 2:
                logger.warning(f"No file extension found in: {file.filename}")
                return False
            file_ext = filename_parts[-1]
            if f'.{file_ext}' not in allowed_extensions:
                logger.warning(f"Unsupported file extension: {file_ext}")
                return False
        
        return True
        
    except Exception as e:
        logger.error(f"Error validating file: {e}")
        return False

def format_file_size(size_bytes: int) -> str:
    """Format file size in human readable format"""
    if size_bytes == 0:
        return "0 B"
    
    size_names = ["B", "KB", "MB", "GB"]
    i = int(math.floor(math.log(size_bytes, 1024)))
    p = math.pow(1024, i)
    s = round(size_bytes / p, 2)
    return f"{s} {size_names[i]}"

def sanitize_filename(filename: str) -> str:
    """Sanitize filename for safe storage"""
    # Remove or replace unsafe characters
    filename = re.sub(r'[^\w\-_\.]', '_', filename)
    # Remove multiple underscores
    filename = re.sub(r'_+', '_', filename)
    # Limit length
    if len(filename) > 255:
        name, ext = filename.rsplit('.', 1) if '.' in filename else (filename, '')
        max_name_length = 255 - len(ext) - 1
        filename = name[:max_name_length] + '.' + ext if ext else name[:255]
    
    return filename

def get_image_info(image_data: bytes) -> Optional[dict]:
    """Get basic image information from image data"""
    try:
        from PIL import Image
        import io
        
        image = Image.open(io.BytesIO(image_data))
        
        return {
            "format": image.format,
            "mode": image.mode,
            "size": image.size,
            "width": image.width,
            "height": image.height
        }
        
    except Exception as e:
        logger.error(f"Failed to get image info: {e}")
        return None

def create_error_response(error: str, detail: Optional[str] = None, status_code: int = 500) -> dict:
    """Create standardized error response"""
    response = {
        "success": False,
        "error": error,
        "status_code": status_code
    }
    
    if detail:
        response["detail"] = detail
    
    return response

def log_request_info(file: UploadFile, model: str, threshold: float):
    """Log request information for debugging"""
    file_info = {
        "filename": file.filename,
        "content_type": file.content_type,
        "size": getattr(file, 'size', 'unknown')
    }
    
    logger.info(f"Processing request - File: {file_info}, Model: {model}, Threshold: {threshold}")

def validate_threshold(threshold: float) -> bool:
    """Validate segmentation threshold"""
    return 0.0 <= threshold <= 1.0

def validate_model_name(model_name: str) -> bool:
    """Validate model name"""
    allowed_models = {"hrnet", "resunet_advanced", "resunet_small"}
    return model_name in allowed_models

class Timer:
    """Simple timer context manager for performance monitoring"""
    
    def __init__(self, name: str):
        self.name = name
        self.start_time = None
        
    def __enter__(self):
        self.start_time = time.time()
        return self
        
    def __exit__(self, *args):
        if self.start_time:
            elapsed = time.time() - self.start_time
            logger.info(f"{self.name} completed in {elapsed:.3f}s")