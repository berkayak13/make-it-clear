# Architecture Documentation

## Overview

The On-Device Renarration Assistant is a Chrome Extension built on Manifest V3 that provides real-time text reformulation and visual description capabilities. The extension is designed with a modular architecture that separates concerns and enables easy integration with actual on-device AI models.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Chrome Browser                           │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Web Page (Any Site)                      │ │
│  │                                                              │ │
│  │  ┌─────────────────────────────────────────────────────┐  │ │
│  │  │         Content Script (content.js)                  │  │ │
│  │  │  • Detects text selection                           │  │ │
│  │  │  • Injects UI overlay (content.css)                 │  │ │
│  │  │  • Shows renarration trigger button                 │  │ │
│  │  └─────────────────────────────────────────────────────┘  │ │
│  │                           ↕                                  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                               ↕                                   │
│                       Message Passing API                         │
│                               ↕                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │         Background Service Worker (background.js)          │ │
│  │  • Manages extension lifecycle                            │ │
│  │  • Handles renarration requests                           │ │
│  │  • Stores user tasks & settings                        │ │
│  │  • Simulates LLM/VLM processing                           │ │
│  │  • [Future: Integrates with Web LLM]                      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                               ↕                                   │
│                        Chrome Storage API                         │
│                               ↕                                   │
│  ┌─────────────┐    ┌──────────────────┐    ┌────────────────┐ │
│  │   Popup     │    │   Options Page   │    │  Extension     │ │
│  │ (popup.*)   │    │  (options.*)     │    │    Icon        │ │
│  │ • Quick       │    │ • Task mgmt      │    │                │ │
│  │   settings    │    │ • Personas       │    │                │ │
│  │ • Task        │    │ • Prompt template│    │                │ │
│  │   switch      │    │ • Remote VLM     │    │                │ │
│  └─────────────┘    └──────────────────┘    └────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. Manifest (manifest.json)
**Purpose**: Extension configuration and permissions
- Declares Manifest V3 compliance
- Defines permissions (storage, activeTab, scripting)
- Configures service worker and content scripts
- Specifies popup and options pages

**Key Features**:
```json
{
  "manifest_version": 3,
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [...]
}
```

### 2. Background Service Worker (background.js)
**Purpose**: Central processing and state management
- **Functions**: 
  - `renarrateText()`: Processes text renarration requests
  - `describeImage()`: Handles image description requests
  - `simulateLocalLLM()`: Simulates text processing (to be replaced)
  - `simulateLocalVLM()`: Simulates image processing (to be replaced)

**Message Handlers**:
```javascript
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'renarrate-text') { ... }
  if (request.action === 'describe-image') { ... }
  if (request.action === 'get-settings') { ... }
});
```

**Default Tasks**: 4 built-in tasks (Simple, Detailed, Academic, Summary)

### 3. Content Script (content.js)
**Purpose**: Page interaction and UI injection
- **Event Listeners**:
  - `mouseup`: Text selection detection

**UI Components**:
- Selection button (🔄)
- Floating overlay for results

**Communication**:
```javascript
chrome.runtime.sendMessage({
  action: 'renarrate-text',
  text: selectedText,
  task: currentTask
}).then(response => { ... });
```

### 4. Content Styles (content.css)
**Purpose**: Styling for injected UI elements
- Renarration overlay styling
- Button animations
- Loading states
- Error messages
- High z-index to appear above page content

### 5. Popup UI (popup.html/js/css)
**Purpose**: Quick access controls
- Enable/disable toggle
- Task selector dropdown
- Auto-detect checkbox
- Usage instructions
- Link to options page

**User Interactions**:
- Toggle extension on/off
- Switch between tasks
- Access advanced settings

### 6. Options Page (options.html/js/css)
**Purpose**: Advanced configuration
- **Task Management**:
  - View all tasks (default + custom)
  - Create custom tasks
  - Edit existing tasks
  - Delete custom tasks

- **Persona Management**:
  - View all personas (default + custom)
  - Create custom personas
  - Edit existing personas
  - Delete custom personas

- **System Prompt Template**:
  - Edit template text
  - Preview effective prompt
  - Restore defaults

- **Remote VLM Settings**:
  - Enable hosted VLM
  - Configure endpoint/model/API key

- **UI Features**:
  - Modal for task editing
  - Form validation
  - Save status feedback

### 7. Storage Architecture

**Chrome Storage Sync**:
```javascript
{
  enabled: boolean,           // Extension on/off
  currentTask: string,     // Active task key
  tasks: {                 // Task definitions
    'simple': { ... },
    'detailed': { ... },
    'academic': { ... },
    'summary': { ... },
    'custom-1': { ... }       // User-created
  }
}
```

## Data Flow

### Text Renarration Flow
```
1. User selects text on page
   ↓
2. Content script detects selection
   ↓
3. Shows 🔄 button
   ↓
4. Sends message to background worker
   ↓
5. Background retrieves task settings
   ↓
6. Processes text (simulated LLM)
   ↓
7. Returns renarrated text
   ↓
8. Content script displays in overlay
   ↓
9. User reads and closes overlay
```

### Task Management Flow
```
1. User opens options page
   ↓
2. Loads tasks from storage
   ↓
3. User creates/edits task
   ↓
4. Validates input
   ↓
5. Saves to Chrome Storage
   ↓
6. Updates UI to reflect changes
   ↓
7. Available in popup dropdown
```

## Security Considerations

### Current Implementation
- Content Security Policy compliant
- Minimal permissions requested
- Isolated execution contexts
- No external API calls in prototype

### Production Considerations
1. **Web LLM Integration**:
   - Models loaded from trusted sources
   - Verified model signatures
   - Sandboxed execution

2. **Data Privacy**:
   - All processing local
   - No telemetry or tracking
   - User data never leaves device

3. **Permissions**:
   - `activeTab`: Only access active page
   - `storage`: Local settings only
   - `scripting`: Required for content injection

## Performance Characteristics

### Current (Simulated)
- Text renarration: ~500ms
- Image description: ~800ms
- UI responsiveness: <100ms
- Memory footprint: ~10MB

### Expected (Production with Web LLM)
- Model loading: 2-5s (first time, then cached)
- Text renarration: 1-3s (depending on model/hardware)
- Image description: 2-5s (VLM models)
- Memory footprint: 100-500MB (with loaded models)

## Extension Points

### For Production Integration

1. **Replace Simulation Functions**:
```javascript
// In background.js
async function renarrateText(text, taskName) {
  // Replace simulateLocalLLM with:
  const webLLM = await initializeWebLLM();
  const result = await webLLM.generate(prompt, options);
  return result;
}
```

2. **Add Model Management**:
```javascript
// New module: model-manager.js
class ModelManager {
  async loadModel(modelName) { ... }
  async unloadModel(modelName) { ... }
  async warmup() { ... }
}
```

3. **Add Caching Layer**:
```javascript
// New module: cache.js
class ResultCache {
  async get(key) { ... }
  async set(key, value, ttl) { ... }
  async clear() { ... }
}
```

## Testing Strategy

### Unit Testing
- Individual component functions
- Message passing logic
- Task management
- Storage operations

### Integration Testing
- Content script ↔ Background worker
- UI components ↔ Storage
- Cross-component workflows

### End-to-End Testing
- Complete user workflows
- Multi-page scenarios
- Task switching
- Error handling

### Manual Testing
- See `TESTING.md` for comprehensive test cases
- Use `test-page.html` for structured testing

## Future Enhancements

1. **Model Integration**: Web LLM/VLM support
2. **Batch Processing**: Multiple selections at once
3. **History**: Save renarration history
4. **Export**: Save results to file
5. **Multi-language**: i18n support
6. **Voice**: Text-to-speech output
7. **Themes**: Customizable UI
8. **Tasks**: Import/export/share

## Development Workflow

### Adding a New Task
1. Add to `DEFAULT_TASKS` in `background.js`
2. Update task selector in `popup.html`
3. Add description to `options.js`
4. Test with various content types

### Adding a New Feature
1. Update manifest if new permissions needed
2. Implement in appropriate component
3. Add message passing if cross-component
4. Update UI accordingly
5. Add to test cases
6. Document in README

### Code Style
- ES6+ JavaScript
- Async/await for promises
- Chrome Extension APIs v3
- Semantic HTML
- BEM-inspired CSS
- JSDoc comments for functions

## File Size Reference

```
manifest.json     ~1 KB
background.js     ~6 KB
content.js        ~7 KB
content.css       ~2 KB
popup.*          ~8 KB
options.*        ~17 KB
icons/           ~2 KB
README.md        ~6 KB
TESTING.md       ~8 KB
QUICKSTART.md    ~4 KB
----------------
Total:           ~61 KB
```

## Browser Compatibility

- Chrome 88+ ✅
- Edge 88+ ✅
- Brave 1.24+ ✅
- Opera 74+ ✅
- Firefox ❌ (requires Manifest V3 adaptations)
- Safari ❌ (different extension API)

## License

MIT License - See LICENSE file for details

---

**For implementation questions or contributions, see README.md and CONTRIBUTING.md**
