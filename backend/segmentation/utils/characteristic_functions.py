import cv2
import numpy as np
def calculate_area_from_contour(contour):
    return cv2.contourArea(contour)
def calculate_perimeter_from_contour(contour):
    return cv2.arcLength(contour, True)

def calculate_equivalent_diameter_from_contour(contour):
    area = calculate_area_from_contour(contour)
    return np.sqrt(4 * area / np.pi)

def calculate_convex_perimeter_from_contour(contour):
    convex_hull = cv2.convexHull(contour)
    return cv2.arcLength(convex_hull, True)

def calculate_circularity_from_contour(contour):
    area = calculate_area_from_contour(contour)
    perimeter = calculate_perimeter_from_contour(contour)
    return (4 * np.pi * area) / (perimeter ** 2) if perimeter else 0


def calculate_convexity_from_contour(contour):
    hull = cv2.convexHull(contour)
    hull_perimeter = cv2.arcLength(hull, True)
    contour_perimeter = calculate_perimeter_from_contour(contour)
    return hull_perimeter / contour_perimeter if contour_perimeter else 0

def calculate_solidity_from_contour(contour):
    area = calculate_area_from_contour(contour)
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    return area / hull_area if hull_area else 0

def calculate_sphericity_from_contour(contour):
    area = calculate_area_from_contour(contour)
    perimeter = calculate_perimeter_from_contour(contour)
    return np.pi * np.sqrt(4 * area / np.pi) / perimeter if perimeter else 0

def calculate_compactness_from_contour(contour):
    """
    Calculate compactness: P²/(4πA) - reciprocal of circularity
    Values equal 1 for perfect circle, increase for complex shapes
    Following ImageJ standard definition
    """
    area = calculate_area_from_contour(contour)
    perimeter = calculate_perimeter_from_contour(contour)
    return (perimeter ** 2) / (4 * np.pi * area) if area > 0 else 0

def calculate_extent_from_contour(contour):
    """
    Calculate extent: area / bounding box area
    Measures how much of the bounding box is filled by the shape
    """
    area = calculate_area_from_contour(contour)
    x, y, w, h = cv2.boundingRect(contour)
    bbox_area = w * h
    return area / bbox_area if bbox_area > 0 else 0

def calculate_bounding_box_dimensions(contour):
    """
    Calculate axis-aligned bounding box width and height
    """
    x, y, w, h = cv2.boundingRect(contour)
    return float(w), float(h)


def calculate_feret_properties_from_contour(contour):
    # Check if contour has sufficient points for minAreaRect
    if len(contour) < 2:
        return (0.0, 0.0, 0.0)
    
    # Find minimal bounding rectangle that encloses the contour
    rect = cv2.minAreaRect(contour)
    (width, height) = rect[1]

    # Determine Maximum and Minimum Feret diameters
    feret_diameter_max = float(max(width, height))
    feret_diameter_min = float(min(width, height))

    # Calculate Feret aspect ratio
    feret_aspect_ratio = feret_diameter_max / feret_diameter_min if feret_diameter_min else 0.0

    return feret_diameter_max, feret_diameter_min, feret_aspect_ratio


def calculate_diameters_from_contour(contour):
    # Validate contour has minimum required points for fitEllipse
    if contour is None or len(contour) < 5:
        return 0, 0
    
    try:
        # Find ellipse that best approximates the contour
        ellipse = cv2.fitEllipse(contour)
        (major_axis_length, minor_axis_length) = ellipse[1]
        return major_axis_length, minor_axis_length
    except cv2.error:
        # Fallback for degenerate contours
        return 0, 0


def calculate_orthogonal_diameter(contour):
    if contour is None or len(contour) < 2:
        return 0

    # Nalezení minimálního obdélníku, který obaluje konturu
    rect = cv2.minAreaRect(contour)
    box = cv2.boxPoints(rect)
    box = np.int0(box)

    # Výpočet vzdáleností mezi páry bodů v rotovaném obdélníku
    distances = [np.linalg.norm(box[i] - box[(i + 1) % 4]) for i in range(4)]

    # Určení ortogonálního průměru jako menší z dvou párů stran
    orthogonal_diameter = min(distances[0::2] + distances[1::2])

    return orthogonal_diameter

def calculate_all(contour, hole_contours=None):
    """
    Calculate all morphometric metrics for a contour

    Args:
        contour: Main contour (numpy array)
        hole_contours: Optional list of hole contours for perimeter calculation
    """
    area = calculate_area_from_contour(contour)
    perimeter = calculate_perimeter_from_contour(contour)

    # Calculate perimeter with holes if provided
    perimeter_with_holes = perimeter
    if hole_contours:
        for hole in hole_contours:
            perimeter_with_holes += cv2.arcLength(hole, True)

    eq_diam = calculate_equivalent_diameter_from_contour(contour)
    # Use perimeter with holes for circularity calculation (ImageJ convention)
    circularity = (4 * np.pi * area) / (perimeter_with_holes ** 2) if perimeter_with_holes > 0 else 0
    circularity = min(1.0, circularity)  # Clamp to [0, 1]

    feret_diameter_max, feret_diameter_min, feret_aspect_ratio = calculate_feret_properties_from_contour(contour)
    feret_max_orthogonal_distance = calculate_orthogonal_diameter(contour)
    major_axis_length, minor_axis_length = calculate_diameters_from_contour(contour)

    # Use correct compactness formula: P²/(4πA)
    compactness = calculate_compactness_from_contour(contour)

    # Convexity uses perimeter with holes for boundary smoothness measure
    hull = cv2.convexHull(contour)
    hull_perimeter = cv2.arcLength(hull, True)
    convexity = hull_perimeter / perimeter_with_holes if perimeter_with_holes > 0 else 0

    solidity = calculate_solidity_from_contour(contour)
    sphericity = calculate_sphericity_from_contour(contour)
    extent = calculate_extent_from_contour(contour)
    bbox_width, bbox_height = calculate_bounding_box_dimensions(contour)

    data = {
        "Area": area,
        "Perimeter": perimeter,
        "PerimeterWithHoles": perimeter_with_holes,
        "EquivalentDiameter": eq_diam,
        "Circularity": circularity,
        "FeretDiameterMax": feret_diameter_max,
        "FeretDiameterMaxOrthogonalDistance": feret_max_orthogonal_distance,
        "FeretDiameterMin": feret_diameter_min,
        "FeretAspectRatio": feret_aspect_ratio,
        "LengthMajorDiameterThroughCentroid": major_axis_length,
        "LengthMinorDiameterThroughCentroid": minor_axis_length,
        "Compactness": compactness,
        "Convexity": convexity,
        "Solidity": solidity,
        "Sphericity": sphericity,
        "Extent": extent,
        "BoundingBoxWidth": bbox_width,
        "BoundingBoxHeight": bbox_height
    }

    return data