# SpheroSeg Business Metrics Grafana Dashboard

This document contains the configuration for creating a comprehensive business metrics dashboard for SpheroSeg.

**Tags**: spheroseg, business, metrics

## Dashboard Configuration

### Data Source

- **Type**: Prometheus
- **URL**: http://prometheus:9090
- **Access**: Server (default)

### Dashboard Settings

- **Name**: SpheroSeg Business Metrics
- **UID**: spheroseg-business
- **Tags**: spheroseg, business, metrics
- **Refresh**: 30s
- **Time Range**: Last 3 hours

## Panel Configurations

### 1. User Activity Section

#### Active Users (Stat Panel)

```
Metrics:
- spheroseg_active_users{period="daily"}
- spheroseg_active_users{period="weekly"}
- spheroseg_active_users{period="monthly"}

Display: Background color, horizontal orientation
```

#### User Registration & Login Rate (Time Series)

```
Metrics:
- rate(spheroseg_user_registrations_total[1h])
- rate(spheroseg_user_logins_total[1h])

Legend: "{{status}} {{method}}"
```

#### 24h User Activity (Stat Panel)

```
Metrics:
- increase(spheroseg_user_registrations_total[24h])
- increase(spheroseg_user_logins_total[24h])
```

### 2. Project & Content Metrics Section

#### Project Statistics (Stat Panel)

```
Metrics:
- spheroseg_projects_active
- spheroseg_average_images_per_project
```

#### Project & Image Activity (Time Series)

```
Metrics:
- rate(spheroseg_projects_created_total[1h])
- rate(spheroseg_images_uploaded_total[1h])

Legend: "{{user_type}}" / "{{status}}"
```

### 3. Segmentation & ML Metrics Section

#### Segmentation Queue Status (Stat Panel)

```
Metrics:
- spheroseg_segmentation_queue_length

Legend: "Queue - {{status}}"
```

#### Model Usage Distribution (Pie Chart)

```
Metrics:
- spheroseg_model_usage_percentage

Legend: "{{model_name}}"
```

#### Segmentation Processing Time Distribution (Time Series)

```
Metrics:
- histogram_quantile(0.50, sum(rate(spheroseg_segmentation_duration_seconds_bucket[5m])) by (le))
- histogram_quantile(0.90, sum(rate(spheroseg_segmentation_duration_seconds_bucket[5m])) by (le))
- histogram_quantile(0.95, sum(rate(spheroseg_segmentation_duration_seconds_bucket[5m])) by (le))

Legend: "50th/90th/95th percentile"
Unit: seconds
```

### 4. Storage & Export Metrics Section

#### Storage Usage by Type (Stat Panel)

```
Metrics:
- spheroseg_storage_used_bytes

Legend: "{{type}} Storage"
Unit: bytes
```

#### Export Activity (Time Series)

```
Metrics:
- rate(spheroseg_exports_created_total[1h])

Legend: "Exports/hour - {{format}} ({{status}})"
```

### 5. Error & System Health Section

#### Business Error Rate (Time Series)

```
Metrics:
- rate(spheroseg_business_errors_total[5m])

Legend: "{{error_type}} in {{operation}}"
```

## Alert Rules (Optional)

### High Error Rate Alert

```
Condition: rate(spheroseg_business_errors_total[5m]) > 0.1
Severity: Warning
Message: "High business error rate detected"
```

### Queue Length Alert

```
Condition: spheroseg_segmentation_queue_length{status="pending"} > 10
Severity: Warning
Message: "Segmentation queue is getting long"
```

### Low User Activity Alert

```
Condition: spheroseg_active_users{period="daily"} < 1
Severity: Info
Message: "Low daily user activity"
```

## Installation Instructions

1. **Access Grafana**: Navigate to http://localhost:3030 (or your Grafana URL)
2. **Login**: Use admin credentials from GRAFANA_ADMIN_PASSWORD
3. **Add Data Source**: Configure Prometheus data source
4. **Import Dashboard**: Create new dashboard using the panel configurations above
5. **Save Dashboard**: Save with UID "spheroseg-business"

## Custom Business Metrics Available

### User Metrics

- `spheroseg_user_registrations_total` - Total user registrations
- `spheroseg_user_logins_total` - Total user logins
- `spheroseg_active_users` - Active users by period

### Project Metrics

- `spheroseg_projects_created_total` - Total projects created
- `spheroseg_projects_active` - Current active projects
- `spheroseg_images_uploaded_total` - Total images uploaded
- `spheroseg_average_images_per_project` - Average images per project

### Segmentation Metrics

- `spheroseg_segmentation_requests_total` - Total segmentation requests
- `spheroseg_segmentation_duration_seconds` - Segmentation processing time
- `spheroseg_segmentation_queue_length` - Current queue status
- `spheroseg_polygons_extracted_total` - Total polygons extracted
- `spheroseg_model_usage_percentage` - Model usage distribution

### Storage Metrics

- `spheroseg_storage_used_bytes` - Storage usage by type
- `spheroseg_storage_used_by_user_bytes` - Per-user storage usage

### Export Metrics

- `spheroseg_exports_created_total` - Total exports created
- `spheroseg_export_duration_seconds` - Export processing time

### Error Metrics

- `spheroseg_business_errors_total` - Business-level errors

## Troubleshooting

### No Data Showing

1. Check Prometheus is scraping: `http://prometheus:9090/targets`
2. Verify metrics endpoint: `http://backend:3001/api/metrics/business`
3. Check Grafana data source connection

### Missing Metrics

1. Ensure business metrics service is initialized
2. Check backend logs for collection errors
3. Verify database connection for metric collection

### Performance Issues

1. Reduce dashboard refresh rate
2. Limit time range for heavy queries
3. Use recording rules for complex calculations
