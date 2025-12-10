# Safety Features

The voice agent includes built-in safety filtering to detect and block inappropriate content in both user inputs and AI-generated responses. The safety system uses a combination of:

- **Text Classification**: Machine learning-based classification to detect unsafe content
- **Keyword Matching**: Pattern-based matching against a configurable keyword list

## Safety Configuration Files

The safety system uses two configuration files:

1. **Keyword List** (`server/config/profanity.json`)
2. **Safety Classifier Model** (`server/config/safety_classifier_model_weights.json`)

### Customize Paths (Optional)

If you want to use different locations for your safety configuration files, set these environment variables in your `server/.env` file:

```bash
# Custom keyword list path
SAFETY_KEYWORDS_PATH=/path/to/your/profanity.json

# Custom classifier model path
SAFETY_CLASSIFIER_MODEL_PATH=/path/to/your/safety_classifier_model_weights.json
```

## Configuring Safety Keywords

By default, the safety system looks for a keyword list at `server/config/profanity.json`.

### Customizing Your Keyword List

The included `server/config/profanity.json` contains an example list. You can edit this file to add or remove keywords as needed. The file should contain a JSON array of strings:

```json
[
  "keyword1",
  "keyword2",
  "keyword3"
]
```

## Configuring Safety Classifiers
By default the following safety classifiers are provided:
- **Hate speech** (`hategroup`): Content that expresses, incites, or promotes hate based on identity via any of the following: gender, race, sexuality, nationality, religion, disability.
- **Self-harm** (`selfharm`): Content that encourages or incites self-harm or suicidal behavior.
- **Child sexual abuse material** (`sexualminors`): Sexual content involving minors.
- **Sexual topics** (`sexual`): Content involving sexual acts, explicit behavior, or adult themes.
- **Substance use** (`substance`): Content related to drugs, tobacco, and other controlled substances.

## Configuring Safety Classifier Thresholds

Safety classifier thresholds can be configured in `server/components/graphs/graph.ts` (around lines 230-251) in the `TextClassifierNode` configuration. The `classifierConfig` property allows you to set custom thresholds for each safety category:

```typescript
classifierConfig: {
  classes: [
    { label: 'hategroup', threshold: 0.75 },
    { label: 'selfharm', threshold: 0.7 },
    { label: 'sexual', threshold: 0.8 },
    { label: 'sexualminors', threshold: 0.97 },
    { label: 'substance', threshold: 0.6 },
  ],
},
```

**Note:** Lower thresholds mean the classifier is more sensitive (will trigger more often).

The `default_threshold` values in `server/config/safety_classifier_model_weights.json` are only used if `classifierConfig` is not provided. When `classifierConfig` is specified, those thresholds override the defaults. 

## How Safety Works

- **Input Safety**: User messages are checked before being sent to the LLM. In this template, unsafe inputs trigger a canned response (see `inputSafetyCannedPhrases` in `server/components/graph.ts`) instead of processing, but the template can be modified to trigger other actions.
- **Output Safety**: AI-generated responses are checked before being sent to TTS. In this template, unsafe outputs trigger a canned response (see `outputSafetyCannedPhrases` in `server/components/graph.ts`) instead of being spoken, but the template can be modified to trigger other actions.
- **Keyword Normalization**: Keywords are normalized (lowercase, punctuation removed) before matching to catch variations and obfuscations.