# User Guide

Welcome to the Cell Segmentation Hub! This guide will help you get started with analyzing your cell images using our AI-powered segmentation tools.

## Getting Started

### 1. Account Setup

#### Registration
1. Navigate to the application homepage
2. Click "Request Access" or "Register"
3. Fill in your information:
   - **Email**: Your professional email address
   - **Name**: Your full name
   - **Institution**: Your organization or university
   - **Purpose**: Brief description of your intended use
4. Submit your request and wait for approval

#### First Login
1. Once approved, you'll receive an email with login instructions
2. Click "Login" and enter your credentials
3. Complete your profile setup:
   - Upload a profile picture (optional)
   - Add a bio describing your research
   - Choose your preferred segmentation model
   - Set your default threshold value
   - Select language and theme preferences

### 2. Dashboard Overview

The main dashboard provides an overview of your projects and recent activity:

- **Project Cards**: Visual summary of each project with image count and progress
- **Recent Activity**: Latest uploads and segmentation results
- **Quick Actions**: Create new project, upload images, access settings
- **Statistics**: Overall usage statistics and storage information

## Working with Projects

### Creating a New Project

1. Click "New Project" from the dashboard
2. Enter project details:
   - **Title**: Descriptive name for your project
   - **Description**: Optional detailed description
3. Click "Create Project"

Your new project will appear in the dashboard with an empty state.

### Project Management

#### Project Actions
- **View Details**: Click on project card to see all images and results
- **Edit Project**: Update title and description
- **Delete Project**: Permanently remove project and all data
- **Export Results**: Download segmentation data in various formats

#### Project Statistics
Each project shows:
- Total number of images
- Completed segmentations
- Processing status
- Creation and last modified dates

## Image Upload and Management

### Uploading Images

1. Navigate to a project or use the global upload
2. Choose upload method:
   - **Drag & Drop**: Drag image files directly onto the upload area
   - **Click to Browse**: Select files from your computer
   - **Batch Upload**: Select multiple images at once

#### Supported Formats
- **JPEG/JPG**: Most common format, good compression
- **PNG**: Lossless format, larger file sizes
- **File Size Limit**: 50MB per image
- **Batch Limit**: 20 images per upload

#### Upload Options
- **Auto-Segmentation**: Automatically start segmentation after upload
- **Model Selection**: Choose which AI model to use
- **Threshold Setting**: Set confidence threshold for segmentation

### Image Management

#### Image Gallery
- **Thumbnail View**: Quick overview of all images
- **List View**: Detailed information including status and metadata
- **Filter Options**: Filter by processing status, upload date, or size
- **Sort Options**: Sort by name, date, size, or status

#### Image Actions
- **View Details**: See full-size image and metadata
- **Start Segmentation**: Manually trigger AI processing
- **View Results**: Examine segmentation polygons and statistics
- **Download**: Get original image or processed results
- **Delete**: Remove image and associated data

## AI Segmentation

### Available Models

#### HRNetV2 (Recommended)
- **Best for**: High-precision research applications
- **Processing Time**: ~15-20 seconds per image
- **Strengths**: Highest accuracy, excellent fine detail detection
- **Use Cases**: Publication-quality analysis, detailed morphology studies

#### ResUNet Advanced
- **Best for**: Balanced accuracy and processing time
- **Processing Time**: ~6-8 seconds per image
- **Strengths**: Good accuracy with attention mechanisms
- **Use Cases**: Routine analysis, batch processing

#### ResUNet Small
- **Best for**: Fast processing of large batches
- **Processing Time**: ~3-4 seconds per image
- **Strengths**: Fastest processing, good general accuracy
- **Use Cases**: Quick screening, large-scale studies

### Segmentation Process

#### Automatic Segmentation
1. Upload images with "Auto-Segmentation" enabled
2. AI processing begins automatically
3. Monitor progress in the project view
4. Review results when processing completes

#### Manual Segmentation
1. Navigate to an uploaded image
2. Click "Start Segmentation"
3. Select model and threshold settings
4. Click "Process" to begin analysis

#### Processing Status
- **Pending**: Queued for processing
- **Processing**: AI model is analyzing the image
- **Completed**: Segmentation finished successfully
- **Failed**: Error occurred during processing

### Understanding Results

#### Segmentation Data
Each processed image provides:
- **Polygon Count**: Number of detected cells/objects
- **Total Area**: Combined area of all detected objects
- **Average Size**: Mean area per object
- **Confidence Score**: AI model confidence (0-1)
- **Processing Time**: Time taken for analysis

#### Visual Results
- **Overlay View**: Original image with colored polygon overlays
- **Mask View**: Binary mask showing detected objects
- **Individual Objects**: Click on polygons to see individual measurements
- **Zoom Tools**: Detailed examination of results

## Segmentation Editor

### Advanced Editing Tools

#### Edit Modes
- **View Mode**: Navigate and examine results
- **Edit Mode**: Modify existing polygons
- **Add Mode**: Create new polygons manually
- **Slice Mode**: Split polygons into multiple objects

#### Polygon Operations
- **Vertex Editing**: Add, remove, or move polygon vertices
- **Polygon Deletion**: Remove incorrect detections
- **Polygon Duplication**: Copy polygons to similar objects
- **Merge Polygons**: Combine multiple polygons into one

#### Navigation Tools
- **Zoom**: Mouse wheel or zoom controls (40%-600%)
- **Pan**: Click and drag to navigate large images
- **Reset View**: Return to fit-to-screen view
- **Minimap**: Overview of current viewport position

### Keyboard Shortcuts

#### Navigation
- **Mouse Wheel**: Zoom in/out
- **Middle Click + Drag**: Pan around image
- **R**: Reset view to fit screen

#### Editing
- **E**: Toggle edit mode
- **A**: Toggle point adding mode
- **S**: Toggle slicing mode
- **Delete/Backspace**: Delete selected polygon
- **Escape**: Exit current mode

#### History
- **Ctrl+Z** (Cmd+Z): Undo last action
- **Ctrl+Y** (Cmd+Shift+Z): Redo last undone action

### Best Practices for Editing

1. **Start with AI Results**: Let the AI do most of the work
2. **Focus on Errors**: Only edit obvious mistakes
3. **Use Zoom**: Zoom in for precise vertex placement
4. **Save Frequently**: Changes are auto-saved, but be mindful
5. **Consistent Criteria**: Apply same standards across your dataset

## Data Export

### Export Formats

#### COCO Format (JSON)
```json
{
  "images": [{"id": 1, "width": 1024, "height": 768, "file_name": "cell_001.jpg"}],
  "annotations": [
    {
      "id": 1,
      "image_id": 1,
      "category_id": 1,
      "segmentation": [[12.5, 34.0, 56.2, 78.1, 90.0, 12.3, 45.6, 67.8]],
      "area": 1250.5,
      "bbox": [12.5, 12.0, 120.0, 100.0]
    }
  ],
  "categories": [{"id": 1, "name": "cell"}]
}
```

#### Excel Spreadsheet
- Image metadata (name, size, dimensions)
- Polygon statistics (count, total area, average size)
- Individual polygon measurements
- Summary statistics per image

#### CSV Data
- Simplified tabular format
- One row per detected object
- Columns for image ID, polygon ID, area, coordinates
- Easy import into analysis software

### Export Options

#### Project-Level Export
1. Navigate to project overview
2. Click "Export Results"
3. Select desired format and options
4. Download the generated file

#### Image-Level Export
1. Open specific image results
2. Click "Export" in the toolbar
3. Choose format and polygon selection
4. Save to your computer

#### Batch Export
1. Select multiple images using checkboxes
2. Use "Bulk Actions" menu
3. Choose "Export Selected"
4. Configure export settings

## User Settings

### Profile Management

#### Personal Information
- Update name and email
- Change password
- Upload profile picture
- Edit bio and research interests

#### Preferences
- **Language**: Czech (Čeština) or English
- **Theme**: Light or dark mode
- **Default Model**: Preferred AI model for new segmentations
- **Default Threshold**: Standard confidence threshold
- **Email Notifications**: Control email alerts

#### Storage and Quotas
- View current storage usage
- Monitor monthly processing limits
- Request quota increases if needed

### Account Security

#### Password Requirements
- Minimum 8 characters
- Must include uppercase and lowercase letters
- Must include numbers and special characters
- Cannot reuse recent passwords

#### Two-Factor Authentication (Future)
- SMS-based verification
- Authenticator app support
- Backup codes for recovery

## Data Privacy & Retention

### Data Storage
- **Primary Storage**: European Union (EU) data centers
- **Backup Storage**: Encrypted backups in EU-compliant facilities
- **Cloud Provider**: AWS EU-Central region with GDPR compliance

### Data Retention Periods
- **Active Account Data**: Retained while account is active
- **Deleted Account Data**: Removed within 90 days of account deletion
- **Image Data**: Automatically purged 180 days after last access
- **Segmentation Results**: Retained for 1 year after creation
- **Audit Logs**: Maintained for 365 days for security purposes

### Data Deletion Process
1. **Automated Deletion**: Data automatically removed per retention schedule
2. **Manual Deletion**: Users can delete their data anytime via account settings
3. **Complete Removal**: All data permanently erased within 30 days of request

### Data Export & Portability
- **Export Your Data**: Request full data export via Settings > Privacy
- **Supported Formats**: JSON, CSV, ZIP archive with all images
- **Processing Time**: Data package ready within 24-48 hours
- **Download Period**: Available for 7 days after generation

### Requesting Data Removal
1. **Via Account Settings**: Settings > Privacy > Delete My Data
2. **Email Request**: Send request to spheroseg@utia.cas.cz
3. **Verification**: Identity verification required for security
4. **Confirmation**: Email confirmation sent upon completion
5. **Timeline**: Complete removal within 30 days

### Legal Basis for Retention
- **Contractual Necessity**: Data retained to provide service
- **Legal Obligations**: Compliance with EU data protection laws
- **Legitimate Interests**: Security and fraud prevention
- **User Consent**: Optional data uses require explicit consent

### Contact for Privacy Concerns
- **Email**: spheroseg@utia.cas.cz
- **Response Time**: Within 48 hours on business days
- **Privacy Policy**: Full policy at [Privacy Policy](/privacy-policy)

## Troubleshooting

### Common Issues

#### Upload Problems
- **File too large**: Reduce image size or file format
- **Unsupported format**: Convert to JPEG or PNG
- **Network timeout**: Try uploading smaller batches

#### Segmentation Issues
- **No objects detected**: Try lower threshold value
- **Too many false positives**: Increase threshold value
- **Poor quality results**: Check image quality, try different model

#### Performance Issues
- **Slow loading**: Check internet connection
- **Browser freezing**: Try refreshing page, use latest browser
- **Memory errors**: Close other browser tabs

### Getting Help

#### Documentation
- Read relevant sections of this user guide
- Check the FAQ section
- Review video tutorials (if available)

#### Support Channels
- **Email Support**: spheroseg@utia.cas.cz
- **User Forum**: community.cellsegmentation.com
- **Bug Reports**: Use the in-app feedback form

#### Feature Requests
- Submit suggestions through the feedback form
- Participate in user surveys
- Join beta testing programs

## Tips for Best Results

### Image Quality
1. **High Resolution**: Use images with sufficient detail
2. **Good Contrast**: Ensure cells are clearly distinguishable
3. **Even Lighting**: Avoid shadows and overexposure
4. **Focus**: Keep objects of interest in sharp focus
5. **Minimal Artifacts**: Reduce noise, dust, and bubbles

### Model Selection
- **HRNet**: Best for high-quality images with complex morphology
- **ResUNet Advanced**: Good for standard microscopy images
- **ResUNet Small**: Suitable for simple, well-contrasted images

### Threshold Tuning
- **Start with 0.5**: Default threshold works for most cases
- **Lower values (0.3-0.4)**: Include more uncertain detections
- **Higher values (0.6-0.8)**: Only high-confidence detections
- **Test on sample**: Experiment with different values

### Workflow Optimization
1. **Organize Projects**: Group related images together
2. **Batch Processing**: Upload and process multiple images at once
3. **Consistent Settings**: Use same model and threshold for comparison
4. **Regular Backups**: Export results periodically
5. **Quality Control**: Spot-check AI results for accuracy

## Advanced Features

### Batch Operations
- **Select Multiple**: Use checkboxes to select multiple images
- **Bulk Segmentation**: Process multiple images with same settings
- **Batch Export**: Export results from multiple images
- **Batch Delete**: Remove multiple images at once

### Collaboration (Future)
- **Project Sharing**: Invite collaborators to projects
- **Permission Levels**: Viewer, editor, or admin access
- **Comments**: Add notes to images or results
- **Version History**: Track changes and edits

### API Access (Advanced Users)
- **REST API**: Programmatic access to all features
- **API Keys**: Generate tokens for authentication
- **Batch Uploads**: Automated image processing
- **Custom Integration**: Connect with your existing tools

This user guide covers the core functionality of the Cell Segmentation Hub. For technical details, see the [API Documentation](../api/) or contact support for additional help.