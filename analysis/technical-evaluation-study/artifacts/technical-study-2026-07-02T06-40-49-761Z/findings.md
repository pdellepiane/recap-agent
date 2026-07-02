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
  "studyId": "technical-study-2026-07-02T06-40-49-761Z",
  "dryRun": false,
  "manifestId": "technical-evaluation-50-v1",
  "manifestVersion": 1,
  "frozenAt": "2026-07-01T00:00:00-05:00",
  "repetitions": 3,
  "distinctScenarios": 50,
  "executedConversations": 150,
  "completed": 39,
  "completionRate": 0.26,
  "completionWilson95": {
    "lower": 0.19642138912816148,
    "upper": 0.3355643281685153
  },
  "outcomes": {
    "failed_assertion": 111,
    "completed": 39
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
      "failed_assertion": 27,
      "completed": 3
    },
    "birthday": {
      "completed": 15,
      "failed_assertion": 15
    },
    "baby_shower": {
      "failed_assertion": 27,
      "completed": 3
    },
    "corporate": {
      "failed_assertion": 27,
      "completed": 3
    },
    "social": {
      "completed": 15,
      "failed_assertion": 15
    }
  },
  "outcomesByRouteFamily": {
    "recommendation": {
      "failed_assertion": 9,
      "completed": 6
    },
    "clarification": {
      "failed_assertion": 15
    },
    "multi_need": {
      "failed_assertion": 15
    },
    "refinement": {
      "failed_assertion": 9,
      "completed": 6
    },
    "selection": {
      "failed_assertion": 9,
      "completed": 6
    },
    "pause_resume": {
      "failed_assertion": 15
    },
    "closure": {
      "failed_assertion": 9,
      "completed": 6
    },
    "faq": {
      "completed": 15
    },
    "no_results": {
      "failed_assertion": 15
    },
    "error_recovery": {
      "failed_assertion": 15
    }
  },
  "expectationPassRates": {
    "expected-node-path": {
      "passed": 95,
      "total": 150,
      "rate": 0.6333333333333333
    },
    "terminal-node": {
      "passed": 83,
      "total": 150,
      "rate": 0.5533333333333333
    },
    "persistence": {
      "passed": 150,
      "total": 150,
      "rate": 1
    },
    "search-state": {
      "passed": 99,
      "total": 150,
      "rate": 0.66
    },
    "shortlist": {
      "passed": 45,
      "total": 45,
      "rate": 1
    },
    "event-type": {
      "passed": 145,
      "total": 150,
      "rate": 0.9666666666666667
    },
    "need-0": {
      "passed": 54,
      "total": 135,
      "rate": 0.4
    },
    "token-usage": {
      "passed": 150,
      "total": 150,
      "rate": 1
    },
    "turn-budget": {
      "passed": 150,
      "total": 150,
      "rate": 1
    },
    "need-1": {
      "passed": 9,
      "total": 15,
      "rate": 0.6
    },
    "need-2": {
      "passed": 6,
      "total": 12,
      "rate": 0.5
    },
    "need-3": {
      "passed": 0,
      "total": 3,
      "rate": 0
    }
  },
  "repeatability": {
    "stableCompletedCount": 13,
    "stableFailedCount": 37,
    "flakyCount": 0,
    "flakyRate": 0,
    "stableCompleted": [
      "study.wedding.08",
      "study.birthday.01",
      "study.birthday.04",
      "study.birthday.05",
      "study.birthday.07",
      "study.birthday.08",
      "study.baby_shower.08",
      "study.corporate.08",
      "study.social.01",
      "study.social.04",
      "study.social.05",
      "study.social.07",
      "study.social.08"
    ],
    "stableFailed": [
      "study.wedding.01",
      "study.wedding.02",
      "study.wedding.03",
      "study.wedding.04",
      "study.wedding.05",
      "study.wedding.06",
      "study.wedding.07",
      "study.wedding.09",
      "study.wedding.10",
      "study.birthday.02",
      "study.birthday.03",
      "study.birthday.06",
      "study.birthday.09",
      "study.birthday.10",
      "study.baby_shower.01",
      "study.baby_shower.02",
      "study.baby_shower.03",
      "study.baby_shower.04",
      "study.baby_shower.05",
      "study.baby_shower.06",
      "study.baby_shower.07",
      "study.baby_shower.09",
      "study.baby_shower.10",
      "study.corporate.01",
      "study.corporate.02",
      "study.corporate.03",
      "study.corporate.04",
      "study.corporate.05",
      "study.corporate.06",
      "study.corporate.07",
      "study.corporate.09",
      "study.corporate.10",
      "study.social.02",
      "study.social.03",
      "study.social.06",
      "study.social.09",
      "study.social.10"
    ],
    "flaky": []
  },
  "uniqueObservedRoutes": 16,
  "nodeCoverage": {
    "observed": 18,
    "total": 26,
    "rate": 0.6923076923076923,
    "nodes": [
      "aclarar_pedir_faltante",
      "anadir_a_proveedores_recomendados",
      "buscar_proveedores",
      "busqueda_exitosa",
      "consultar_faq",
      "contacto_inicial",
      "crear_lead_cerrar",
      "deteccion_intencion",
      "elicitacion_necesidades",
      "entrevista",
      "existe_plan_guardado",
      "guardar_cerrar_temporalmente",
      "hay_resultados",
      "minimos_para_buscar",
      "recomendar",
      "refinar_criterios",
      "seguir_refinando_guardar_plan",
      "usuario_elige_proveedor"
    ]
  },
  "transitionCoverage": {
    "registryVersion": "decision-flow-v1-2026-07-01",
    "observed": 33,
    "total": 49,
    "rate": 0.673469387755102
  },
  "latencyMs": {
    "mean": 18654.326666666668,
    "median": 19267,
    "p95": 27296,
    "min": 7117,
    "max": 33314
  },
  "nodeLatencyMs": {
    "recomendar": {
      "visits": 128,
      "meanMs": 11818.78125,
      "p95Ms": 14631
    },
    "elicitacion_necesidades": {
      "visits": 23,
      "meanMs": 15402.217391304348,
      "p95Ms": 19198
    },
    "seguir_refinando_guardar_plan": {
      "visits": 41,
      "meanMs": 6656.365853658536,
      "p95Ms": 8810
    },
    "guardar_cerrar_temporalmente": {
      "visits": 15,
      "meanMs": 5599.466666666666,
      "p95Ms": 8728
    },
    "crear_lead_cerrar": {
      "visits": 15,
      "meanMs": 7739.066666666667,
      "p95Ms": 12129
    },
    "consultar_faq": {
      "visits": 15,
      "meanMs": 8200.666666666666,
      "p95Ms": 9378
    },
    "refinar_criterios": {
      "visits": 12,
      "meanMs": 12315.5,
      "p95Ms": 19425
    },
    "entrevista": {
      "visits": 15,
      "meanMs": 10170.4,
      "p95Ms": 13142
    },
    "aclarar_pedir_faltante": {
      "visits": 6,
      "meanMs": 5792.166666666667,
      "p95Ms": 6325
    }
  },
  "tokensPerConversation": {
    "mean": 34231.59333333333,
    "median": 34416,
    "p95": 61607,
    "min": 16296,
    "max": 74056
  },
  "toolCallsPerConversation": {
    "mean": 1.9266666666666667,
    "median": 2,
    "p95": 5,
    "min": 0,
    "max": 7
  },
  "pricedCostUsdPerConversation": {
    "mean": 0.007098323666255333,
    "median": 0.00657904556805,
    "p95": 0.0124917142003,
    "min": 0.0025106436678,
    "max": 0.0156527809191
  },
  "totalPricedCostUsd": 1.0647485499383,
  "grounding": {
    "requiredTurns": 239,
    "groundedTurns": 239
  },
  "recommendationQuality": {
    "displayedProviders": 790,
    "uniqueProviders": 59,
    "meanShortlistSize": 3.4801762114537445,
    "locationConstraint": {
      "applicable": 628,
      "satisfied": 538,
      "unknown": 90,
      "mismatched": 0,
      "strictSatisfactionRate": 0.856687898089172,
      "mismatchRate": 0
    },
    "categoryConstraint": {
      "applicable": 790,
      "satisfied": 790,
      "satisfactionRate": 1
    },
    "budgetCompatibility": {
      "applicable": 134,
      "compatible": 134,
      "rate": 1
    },
    "eventServiceApplicability": {
      "applicable": 68,
      "supported": 39,
      "rate": 0.5735294117647058
    },
    "needRecommendationCoverage": {
      "needsObserved": 208,
      "needsWithRecommendations": 167,
      "rate": 0.8028846153846154
    },
    "exposure": {
      "hhi": 0.05713186989264535,
      "topProviderShare": 0.09873417721518987
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
