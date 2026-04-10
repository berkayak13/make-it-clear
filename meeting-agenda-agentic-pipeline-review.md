# Meeting Agenda: Agentic Workflow Pipeline Review

**Date:** April 2026 (TBD)  
**Goal:** Align on the new agentic flow, test and see the personalization

---

## 1. New Agentic Workflow Architecture (20 min)

Present the end-to-end pipeline and walk through each stage:

| Stage | Role |
|---|---|
| **Router** | Entry point — routes incoming requests |
| **Intent Recognition** | Processes ~30 chat messages → extracts focus area, goal, output style |
| **Visual / DOM** | Visual processing layer tied to DOM extraction |
| **Planner** | Generates the execution Plan |
| **Parallel Execution** | Multiple worker instances executing off the Plan (Narrator feeds in here) |
| **Guardrails** | Safety and quality checks |
| **End User** | Final delivery of renarrated content |

**Supporting components:**
- **Extractor** — placement TBD
- **Narrator** — feeds into parallel execution steps

**Discussion points:**
- Role and placement of Extractor vs. Narrator — are they separate stages or combined?
- How does the Router decide between text-only, image, and full-page renarration paths?
- Where does the evaluate-retry loop (max 3 attempts, threshold 3.5/5.0) sit relative to Guardrails?

---

## 2. Pipeline Visualizer Demo (10 min)

- Walk through the new pipeline visualization tooling
- Show how each stage's input/output can be inspected and inspect some of the content

---

## 3. Testing the Agentic Workflow — Kicking the Testing Route (15 min)

### Current State 
- No experiment ran for people for now. But talked with some people across the world and luckly we have 5 candidates to test it out. 
- Bisman(Coworker, Indian developer who lives in US now), 
- Nicolas(Friend from Erasmus, Politics student lives in Netherlands), 
- Rukiye(My mom, Who isn't caught up in tech subjects),
- Mert(Neighborhood friend who is far from academic world),
- Me
- We can discuss, how these people should be used to simulate low literate, domain expert and translation features. 

---

## 4. Cross-Cutting Concerns (15 min)

### Literacy Level Adaptation (Highest Priority)
- Must propagate across the **entire** pipeline, not just the final output
- How does Intent Recognition detect literacy level from chat context?
- Does the Planner adjust its plan based on literacy level, or only the Narrator?
- Low/no-literacy renarration: dedicated rephrasing layer for accessibility

### Meaning Extraction (Özünü Çıkartma)
- Define scope: what does this step extract beyond what VLM/DOM already provides?
- Placement: before Planner? Inside Extractor? Will share some insights about my findings.

### Bias Mitigation
- Where do bias checks live? Options:
  - Pre-Planner (catch it before planning)
  - Post-Planner (check the plan itself)
  - Inside Guardrails (catch it at the end)
  - Multiple checkpoints?
  - NOT CURRENTLY IMPLEMENTED! But will be discussed a bit.

---

## 5. KloudEsk API Usage (5 min)

---

## 6. Decisions & Action Items Again (10 min)

### Decisions Needed
1. Scope: which pipeline stages are must-have vs. fast-follow?
2. Extractor vs. Narrator placement and responsibility boundaries
3. Bias check location in the pipeline
4. Literacy adaptation strategy — single layer or pipeline-wide?


---

**Total estimated time: ~80 minutes**
