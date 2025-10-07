#!/bin/bash
# Logrotate cron job for SpheroSeg access logs
# Runs daily at 2:00 AM

/usr/sbin/logrotate /home/cvat/cell-segmentation-hub/docker/logrotate/spheroseg-nginx.conf --state /home/cvat/cell-segmentation-hub/logs/.logrotate-nginx.state
/usr/sbin/logrotate /home/cvat/cell-segmentation-hub/docker/logrotate/spheroseg-backend.conf --state /home/cvat/cell-segmentation-hub/logs/.logrotate-backend.state
