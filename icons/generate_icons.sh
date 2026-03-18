#!/bin/bash
# Generate simple placeholder icons using ImageMagick

# Check if convert command exists
if ! command -v convert &> /dev/null; then
    echo "ImageMagick not found, installing..."
    sudo apt-get update && sudo apt-get install -y imagemagick
fi

# Generate icons with different sizes
for size in 16 48 128; do
    convert -size ${size}x${size} xc:none \
        -fill "#667eea" -draw "circle $((size/2)),$((size/2)) $((size/2)),0" \
        -fill white -pointsize $((size/2)) -gravity center \
        -annotate +0+0 "🔄" \
        icon${size}.png
done

echo "Icons generated successfully!"
