# Testing Guide for On-Device Renarration Extension

This guide provides comprehensive instructions for testing the Chrome extension prototype.

## Installation Steps

1. **Clone the Repository**
   ```bash
   git clone https://github.com/boun-tabi-LMG/on-device-renarration.git
   cd on-device-renarration
   ```

2. **Load Extension in Chrome**
   - Open Chrome browser
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right corner)
   - Click "Load unpacked"
   - Select the `on-device-renarration` directory
   - Verify the extension icon (🔄) appears in the toolbar

## Test Cases

### Test Case 1: Basic Text Renarration

**Objective**: Verify text selection and renarration functionality

**Steps**:
1. Open `test-page.html` in Chrome
2. Select the text in "Test Section 1: Simple Text"
3. Observe the 🔄 button appearing near the selection
4. Click the button
5. Verify processing overlay appears with "Processing text..."
6. Verify renarrated text displays in overlay
7. Click × to close overlay

**Expected Results**:
- Button appears within 100ms of selection
- Overlay displays smoothly
- Text is reformulated according to current task
- Overlay closes cleanly

### Test Case 2: Task Switching

**Objective**: Verify different tasks produce different outputs

**Steps**:
1. Click extension icon to open popup
2. Note current task is "Simple Language"
3. Select same text passage
4. Click the 🔄 button and note the output
5. Change task to "Academic Style"
6. Select same text again
7. Click the 🔄 button and compare output

**Expected Results**:
- Simple Language: Uses short, simple sentences
- Detailed Explanation: Adds context and elaboration
- Academic Style: Uses formal, scholarly language
- Summary: Produces concise key points

### Test Case 3: Enable/Disable Toggle

**Objective**: Test extension on/off functionality

**Steps**:
1. Click extension icon
2. Toggle "Enable Renarration" off
3. Try to select text and trigger renarration
4. Toggle back on
5. Verify functionality returns

**Expected Results**:
- When disabled: No 🔄 button appears
- When re-enabled: All features work again

### Test Case 4: Options Page - Custom Task

**Objective**: Test creating custom user tasks

**Steps**:
1. Click extension icon
2. Click "Advanced Settings"
3. Click "+ Add Custom Task"
4. Enter task details:
   - Name: "Tech Blog"
   - Text Prompt: "Rewrite for a tech blog audience:"
5. Click "Save Task"
6. Return to popup and select "Tech Blog" task
7. Test renarration with new task

**Expected Results**:
- Modal opens cleanly
- Task saves successfully
- New task appears in dropdown
- New task works as configured

### Test Case 5: Cross-Page Compatibility

**Objective**: Verify extension works on various websites

**Steps**:
1. Visit different website types:
   - News site (e.g., news.ycombinator.com)
   - Documentation (e.g., developer.mozilla.org)
   - Social media (e.g., reddit.com)
   - E-commerce (e.g., amazon.com)
2. Test text selection and renarration on each

**Expected Results**:
- Extension works consistently across all sites
- Overlay appears correctly positioned
- No conflicts with site styles
- Performance remains smooth

### Test Case 6: Long Text Handling

**Objective**: Test renarration with long text passages

**Steps**:
1. Open `test-page.html`
2. Select entire "Test Section 7: Long Paragraph"
3. Trigger renarration with the 🔄 button
4. Verify handling of long text

**Expected Results**:
- Processes without errors
- Overlay scrolls if content is long
- Performance acceptable (<2 seconds)

## Performance Benchmarks

### Expected Performance:
- Extension load time: < 500ms
- Text renarration latency: 500-1000ms (simulated)
- VLM description latency: 800-1200ms (simulated)
- UI responsiveness: < 100ms
- Memory footprint: < 50MB

### Monitoring Performance:
1. Open Chrome DevTools
2. Go to Performance tab
3. Trigger extension features
4. Review timeline and memory usage

## Common Issues and Solutions

### Issue: Extension not loading
**Solution**: Ensure manifest.json is valid, check console for errors

### Issue: 🔄 button not appearing
**Solution**: Verify extension is enabled, check if text length is >10 chars

### Issue: Overlay appears off-screen
**Solution**: This is handled in code but report if it occurs

## Browser Console Testing

Open DevTools console and verify:
- No JavaScript errors
- Content script loads successfully
- Background service worker is active
- Messages pass between components

## Accessibility Testing

1. Test with screen readers
2. Verify keyboard navigation works
3. Check color contrast ratios
4. Test with browser zoom at 200%

## Security Testing

1. Verify no external API calls in production
2. Check permissions are minimal
3. Verify no data leakage
4. Test CSP compliance

## Reporting Issues

When reporting bugs, include:
- Chrome version
- Extension version
- Steps to reproduce
- Expected vs actual behavior
- Console errors (if any)
- Screenshots

## Test Results Template

```markdown
## Test Results - [Date]

**Tester**: [Name]
**Chrome Version**: [Version]
**OS**: [Operating System]

### Test Case Results:
- [ ] TC1: Basic Text Renarration - PASS/FAIL
- [ ] TC2: Task Switching - PASS/FAIL
- [ ] TC3: Enable/Disable - PASS/FAIL
- [ ] TC4: Custom Task - PASS/FAIL
- [ ] TC5: Cross-Page Compatibility - PASS/FAIL
- [ ] TC6: Long Text Handling - PASS/FAIL

### Notes:
[Any additional observations or issues]
```

## Automated Testing (Future)

For future development, consider:
- Jest for unit tests
- Puppeteer for E2E tests
- Chrome Extension testing framework
- CI/CD integration

## Next Steps

After successful testing:
1. Document any issues found
2. Verify all test cases pass
3. Create usage videos/screenshots
4. Prepare for production LLM integration
5. Optimize performance based on findings
