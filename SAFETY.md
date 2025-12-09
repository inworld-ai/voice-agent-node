# Safety Features

The voice agent includes built-in safety filtering to detect and block inappropriate content in both user inputs and AI-generated responses. The safety system uses a combination of:

- **Text Classification**: Machine learning-based classification to detect unsafe content
- **Keyword Matching**: Pattern-based matching against a configurable keyword list

## Safety Configuration Files

The safety system uses two configuration files:

1. **Keyword List** (`server/config/profanity.json`)
2. **Safety Classifier Model** (`server/config/safety_classifier_model_weights.json`)

### Configuring Safety Keywords

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

### Customize Paths (Optional)

If you want to use different locations for your safety configuration files, set these environment variables in your `server/.env` file:

```bash
# Custom keyword list path
SAFETY_KEYWORDS_PATH=/path/to/your/profanity.json

# Custom classifier model path
SAFETY_CLASSIFIER_MODEL_PATH=/path/to/your/safety_classifier_model_weights.json
```

## How Safety Works

- **Input Safety**: User messages are checked before being sent to the LLM. Unsafe inputs trigger a canned response instead of processing.
- **Output Safety**: AI-generated responses are checked before being sent to TTS. Unsafe outputs trigger a canned response instead of being spoken.
- **Keyword Normalization**: Keywords are normalized (lowercase, punctuation removed) before matching to catch variations and obfuscations.

## Testing Safety

You can test the keyword matcher directly using:

```bash
cd server
yarn node-keyword-matcher "Your text to check" --keywordsPath="config/profanity.json"
```

This will output whether the text is safe or unsafe, and if unsafe, which keywords were matched.

