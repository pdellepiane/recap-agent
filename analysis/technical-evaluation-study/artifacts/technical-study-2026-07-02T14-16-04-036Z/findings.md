# Technical Evaluation Findings

Generated from immutable evaluation artifacts. This dossier reports technical behavior only; it does not include user testing or baseline comparison.

## Reproducibility

- Manifest: technical-evaluation-50-v1
- Transition registry: decision-flow-v1-2026-07-01
- Raw summary: [summary.json](summary.json)
- Conversation table: [conversations.csv](conversations.csv)
- Grounding audit population: [grounding.csv](grounding.csv)

## Findings

```json
{
  "studyId": "technical-study-2026-07-02T14-16-04-036Z",
  "dryRun": true,
  "manifestId": "technical-evaluation-50-v2",
  "manifestVersion": 2,
  "frozenAt": "2026-07-02T09:00:00-05:00",
  "repetitions": 3,
  "distinctScenarios": 50,
  "executedConversations": 150,
  "completed": 0,
  "completionRate": 0,
  "completionWilson95": {
    "lower": 1.734723475976807e-18,
    "upper": 0.0249702443680766
  },
  "outcomes": {
    "failed_assertion": 150
  },
  "eventGroups": {
    "wedding": 30,
    "birthday": 30,
    "baby_shower": 30,
    "corporate": 30,
    "social": 30
  },
  "routeFamilies": {
    "recommendation": 15,
    "clarification": 15,
    "multi_need": 15,
    "refinement": 15,
    "selection": 15,
    "pause_resume": 15,
    "closure": 15,
    "faq": 15,
    "no_results": 15,
    "error_recovery": 15
  },
  "outcomesByEventGroup": {
    "wedding": {
      "failed_assertion": 30
    },
    "birthday": {
      "failed_assertion": 30
    },
    "baby_shower": {
      "failed_assertion": 30
    },
    "corporate": {
      "failed_assertion": 30
    },
    "social": {
      "failed_assertion": 30
    }
  },
  "outcomesByRouteFamily": {
    "recommendation": {
      "failed_assertion": 15
    },
    "clarification": {
      "failed_assertion": 15
    },
    "multi_need": {
      "failed_assertion": 15
    },
    "refinement": {
      "failed_assertion": 15
    },
    "selection": {
      "failed_assertion": 15
    },
    "pause_resume": {
      "failed_assertion": 15
    },
    "closure": {
      "failed_assertion": 15
    },
    "faq": {
      "failed_assertion": 15
    },
    "no_results": {
      "failed_assertion": 15
    },
    "error_recovery": {
      "failed_assertion": 15
    }
  },
  "expectationPassRates": {},
  "repeatability": {
    "stableCompletedCount": 0,
    "stableFailedCount": 50,
    "flakyCount": 0,
    "flakyRate": 0,
    "stableCompleted": [],
    "stableFailed": [
      "study.wedding.01",
      "study.wedding.02",
      "study.wedding.03",
      "study.wedding.04",
      "study.wedding.05",
      "study.wedding.06",
      "study.wedding.07",
      "study.wedding.08",
      "study.wedding.09",
      "study.wedding.10",
      "study.birthday.01",
      "study.birthday.02",
      "study.birthday.03",
      "study.birthday.04",
      "study.birthday.05",
      "study.birthday.06",
      "study.birthday.07",
      "study.birthday.08",
      "study.birthday.09",
      "study.birthday.10",
      "study.baby_shower.01",
      "study.baby_shower.02",
      "study.baby_shower.03",
      "study.baby_shower.04",
      "study.baby_shower.05",
      "study.baby_shower.06",
      "study.baby_shower.07",
      "study.baby_shower.08",
      "study.baby_shower.09",
      "study.baby_shower.10",
      "study.corporate.01",
      "study.corporate.02",
      "study.corporate.03",
      "study.corporate.04",
      "study.corporate.05",
      "study.corporate.06",
      "study.corporate.07",
      "study.corporate.08",
      "study.corporate.09",
      "study.corporate.10",
      "study.social.01",
      "study.social.02",
      "study.social.03",
      "study.social.04",
      "study.social.05",
      "study.social.06",
      "study.social.07",
      "study.social.08",
      "study.social.09",
      "study.social.10"
    ],
    "flaky": []
  },
  "uniqueObservedRoutes": 1,
  "nodeCoverage": {
    "observed": 0,
    "total": 26,
    "rate": 0,
    "nodes": []
  },
  "transitionCoverage": {
    "registryVersion": "decision-flow-v1-2026-07-01",
    "observed": 0,
    "total": 49,
    "rate": 0
  },
  "latencyMs": {
    "mean": 0,
    "median": 0,
    "p95": 0,
    "min": 0,
    "max": 0
  },
  "nodeLatencyMs": {},
  "tokensPerConversation": {
    "mean": 0,
    "median": 0,
    "p95": 0,
    "min": 0,
    "max": 0
  },
  "toolCallsPerConversation": {
    "mean": 0,
    "median": 0,
    "p95": 0,
    "min": 0,
    "max": 0
  },
  "pricedCostUsdPerConversation": {
    "mean": 0,
    "median": 0,
    "p95": 0,
    "min": 0,
    "max": 0
  },
  "totalPricedCostUsd": 0,
  "grounding": {
    "requiredTurns": 0,
    "groundedTurns": 0
  },
  "recommendationQuality": {
    "displayedProviders": 0,
    "uniqueProviders": 0,
    "meanShortlistSize": 0,
    "locationConstraint": {
      "applicable": 0,
      "satisfied": 0,
      "unknown": 0,
      "mismatched": 0,
      "strictSatisfactionRate": 0,
      "mismatchRate": 0
    },
    "categoryConstraint": {
      "applicable": 0,
      "satisfied": 0,
      "satisfactionRate": 0
    },
    "budgetCompatibility": {
      "applicable": 0,
      "compatible": 0,
      "rate": 0
    },
    "eventServiceApplicability": {
      "applicable": 0,
      "supported": 0,
      "rate": 0
    },
    "needRecommendationCoverage": {
      "needsObserved": 0,
      "needsWithRecommendations": 0,
      "rate": 0
    },
    "expectedNeedEvaluation": {
      "expected": 0,
      "extracted": 0,
      "extractionRecall": 0,
      "extractedAndRecommended": 0,
      "retrievalCoverageGivenExtraction": 0,
      "endToEndCoverage": 0,
      "unexpectedExtractedNeeds": 0
    },
    "exposure": {
      "hhi": 0,
      "topProviderShare": 0
    }
  },
  "runtimeErrors": [],
  "pricing": {
    "version": "2026-07-01",
    "effectiveDate": "2026-07-01",
    "sources": [
      "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
      "https://openai.com/index/introducing-gpt-5-4-mini-and-nano/",
      "https://aws.amazon.com/lambda/pricing/"
    ],
    "models": {
      "gpt-5.4-mini": {
        "inputPerMillionUsd": 0.75,
        "cachedInputPerMillionUsd": 0.075,
        "outputPerMillionUsd": 4.5
      },
      "gpt-5.4-nano": {
        "inputPerMillionUsd": 0.2,
        "cachedInputPerMillionUsd": 0.02,
        "outputPerMillionUsd": 1.25
      }
    },
    "lambda": {
      "requestUsd": 2e-7,
      "gbSecondUsd": 0.0000166667,
      "memoryGb": 1
    }
  }
}
```

## Limitations

- Results describe the development deployment and marketplace snapshot at execution time.
- Internal marketplace API calls are counted but not assigned an invented monetary price.
- Deterministic grounding verifies structured provenance and attributes; free-text recommendation rationales still require the separate manual audit rubric.
- No claims about user satisfaction, adoption, or superiority over a baseline are supported by this study.
