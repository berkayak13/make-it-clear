# Context Object Reference

The context object is the shared state that flows through every agent. Each agent reads fields set by upstream agents and writes its own fields. The orchestrator creates the initial context and passes it to each agent in sequence.

## Initial context (set by orchestrator)

```javascript
{
  // Request info
  rawRequest: string,          // User's original request text
  tabId: number,               // Chrome tab ID for the target page
  url: string,                 // URL of the target page
  pageMetadata: {              // Extracted by content script
    title: string,
    description: string,
    language: string,
    contentType: string        // article, documentation, wiki, etc.
  },
  
  // User config
  task: { name, textPrompt, imagePrompt, maxLength },
  persona: { name, description, systemAddendum },
  
  // Extracted content
  segments: string[],          // Text segments from page DOM
  screenshots: string[],      // Base64 screenshot data (if full-page mode)
  
  // Memory (loaded before pipeline)
  memory: {
    semantic: Object,          // User preferences, expertise, domains
    episodic: Array,           // Past session summaries
    procedural: Object         // What strategies work/fail for this user
  },
  
  // Utilities (injected by orchestrator)
  callLLM: Function,           // (prompt, options) => string
  sendProgress: Function,      // (text) => void
  
  // Pipeline metadata
  sessionId: string,
  pipelineType: null,          // Set by Agent 0
  agentPlan: null              // Set by Agent 0
}
```

## Fields set by each agent

### Agent 0: Pipeline Router
```javascript
context.pipelineType   // 'full' | 'lite' | 'translate' | 'annotate'
context.agentPlan      // string[] — ordered list of agent names to execute
```

### Agent 1: Intent Analyst
```javascript
context.intent = {
  goal: string,                        // What the user wants
  depth: 'brief' | 'moderate' | 'detailed',
  focusAreas: string[],                // Specific topics to emphasize
  outputStyle: 'summary' | 'explanation' | 'bullet-points' | 'conversational' | 'rewrite',
  terminology: {
    preferred: string[],               // Terms to use
    avoided: string[]                  // Terms to avoid
  },
  targetSections: string[] | null,     // Specific sections to focus on
  language: string | null,             // Target language for translation
  isIterative: boolean,                // Is this a refinement of a previous request?
  literacyLevel: 'low' | 'moderate' | 'high',
  confidenceScore: number              // 0-1, how confident the parser is
}
```

### Agent 2: Visual Cartographer
```javascript
context.sectionMap = [
  {
    id: string | number,
    role: string,          // 'headline', 'body', 'feature-list', 'code-block', 'data-table', etc.
    text: string,          // Extracted text content
    importance: number,    // 1-5
    excluded: boolean,     // true for cookie banners, ads, nav
    visualContext: string  // Description of visual presentation
  }
]
```

### Agent 2b: Meaning Extractor
```javascript
context.meaningMap = [
  {
    sectionId: string,
    coreThesis: string,
    entities: string[],
    relationships: string[],
    tone: string,
    facts: string[]
  }
]
```

### Agent 3: Content Strategist
```javascript
context.renarrationPlan = [
  {
    sectionId: string,
    strategy: string,          // 'rewrite', 'simplify vocabulary', 'skip', etc.
    fleschTarget: number,      // Flesch-Kincaid grade level
    wordCountTarget: number | null,
    bestOfN: boolean,          // Generate multiple variants and pick best
    terminology: {
      use: string[],
      avoid: string[]
    },
    priority: number
  }
]
context.globalTerminology = { use: string[], avoid: string[] }
```

### Agent 4: Narrator
```javascript
context.renarrations = [
  {
    sectionId: string,
    originalText: string,
    text: string,              // The renarrated text
    mermaid: string | null,    // Mermaid diagram (if generated)
    variants: string[] | null, // All variants (if bestOfN was true)
    selectedVariant: number | null
  }
]
```

### Agent 6: Quality Validator
```javascript
context.validation = {
  scores: {
    coherence: number,         // 0-5
    coverage: number,          // 0-5
    intentAlignment: number,   // 0-5
    toneConsistency: number,   // 0-5
    literacyAppropriate: number, // 0-5
    averageScore: number       // 0-5
  },
  passed: boolean,             // averageScore >= 3.5
  flaggedSections: [
    { sectionId: string, issue: string, suggestion: string }
  ],
  retryCount: number,
  failureMemory: string[]      // Tracks what went wrong in previous attempts
}
context.needsRetry = boolean   // true if validation failed and retries remain
context.replanSignal = {       // Passed to Strategist on retry
  flaggedSections: Array,
  suggestions: Array
}
```

### Agent 10: Guardrails
```javascript
context.guardrails = {
  passed: boolean,
  flags: [
    {
      type: 'xss' | 'hallucination' | 'bias',
      severity: 'error' | 'warning',
      sectionId: string,
      detail: string
    }
  ]
}
```

### Agent 7: Memory Manager (background)
```javascript
// Mutates context.memory directly:
context.memory.episodic    // Appends session summary
context.memory.semantic    // Updates user preferences
context.memory.procedural  // Records strategy success/failure
context.memory.lastUpdated // ISO timestamp
```

### Agent 9: Predictive Adapter (background)
```javascript
context.predictions = {
  suggestions: [
    {
      label: string,
      description: string,
      intent: Object,          // Pre-filled intent for one-click use
      confidence: number       // 0-1
    }
  ],
  greeting: string
}
```

## Field dependencies

```
Agent 0 (Router):      reads rawRequest, pageMetadata
                       writes pipelineType, agentPlan

Agent 1 (Intent):      reads rawRequest, memory.semantic
                       writes intent

Agent 2 (Cartographer): reads screenshots, tabId
                        writes sectionMap

Agent 2b (Extractor):  reads sectionMap
                       writes meaningMap

Agent 3 (Strategist):  reads intent, sectionMap, memory, [replanSignal]
                       writes renarrationPlan, globalTerminology

Agent 4 (Narrator):    reads intent, sectionMap, renarrationPlan
                       writes renarrations

Agent 6 (Quality):     reads renarrations, intent, sectionMap, renarrationPlan, [validation]
                       writes validation, needsRetry, replanSignal

Agent 10 (Guardrails): reads renarrations, sectionMap
                       writes guardrails
```

## Rules for modifying context

1. **Only write to your agent's fields.** Cross-writing creates hidden coupling.
2. **Never delete fields set by other agents.** Other agents or the orchestrator may still need them.
3. **Append to arrays, don't replace them** — unless you own the field entirely.
4. **Validate before reading.** Always check `context.someField?.length` before iterating. Upstream agents may have failed silently.
5. **Keep field names stable.** Renaming a context field is a breaking change across multiple agents.
