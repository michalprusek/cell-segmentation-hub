#!/bin/bash

# Load environment variables for blue environment
export BLUE_JWT_ACCESS_SECRET=a3f8c9d2e5b7f1c4a6d9e2f5b8c1d4e7f0a3b6c9d2e5f8a1b4c7d0e3f6a9b2c5
export BLUE_JWT_REFRESH_SECRET=b4e9d3f7a2c6e1b5d8f2a5c8b1e4d7f0a3c6b9d2e5f8a1c4b7d0e3f6a9c2b5d8
export DB_PASSWORD=blue_prod_password_2024

# Stop and remove the container
docker-compose -f docker-compose.blue.yml stop blue-backend
docker-compose -f docker-compose.blue.yml rm -f blue-backend

# Start the backend with the correct environment
docker-compose -f docker-compose.blue.yml up -d blue-backend

# Wait a moment and check status
sleep 5
docker ps | grep blue-backend