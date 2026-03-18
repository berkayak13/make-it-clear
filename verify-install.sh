#!/bin/bash
# Installation Verification Script for On-Device Renarration Extension

echo "🔍 Verifying Chrome Extension Installation..."
echo ""

# Check if all required files exist
files=(
    "manifest.json"
    "background.js"
    "content.js"
    "content.css"
    "popup.html"
    "popup.js"
    "popup.css"
    "options.html"
    "options.js"
    "options.css"
    "icons/icon16.png"
    "icons/icon48.png"
    "icons/icon128.png"
)

missing_files=0
for file in "${files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ Missing: $file"
        missing_files=$((missing_files + 1))
    else
        echo "✅ Found: $file"
    fi
done

echo ""

# Check manifest.json is valid JSON
if command -v python3 &> /dev/null; then
    if python3 -m json.tool manifest.json > /dev/null 2>&1; then
        echo "✅ manifest.json is valid JSON"
    else
        echo "❌ manifest.json has syntax errors"
        missing_files=$((missing_files + 1))
    fi
fi

echo ""
echo "================================================"
if [ $missing_files -eq 0 ]; then
    echo "✅ All files present! Extension is ready to load."
    echo ""
    echo "📋 Next Steps:"
    echo "1. Open Chrome and go to chrome://extensions/"
    echo "2. Enable 'Developer mode' (toggle in top-right)"
    echo "3. Click 'Load unpacked'"
    echo "4. Select this directory: $(pwd)"
    echo "5. Look for the 🔄 icon in your toolbar"
    echo ""
    echo "🧪 To test:"
    echo "   Open test-page.html in Chrome"
    echo "   Select text and click the 🔄 button"
    echo ""
    echo "📚 Documentation:"
    echo "   - QUICKSTART.md - Quick installation guide"
    echo "   - README.md     - Full documentation"
    echo "   - TESTING.md    - Test procedures"
else
    echo "❌ Missing $missing_files file(s). Please check the installation."
    exit 1
fi
