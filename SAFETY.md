# Safety Features

The voice agent includes built-in safety filtering to detect and block inappropriate content in both user inputs and AI-generated responses. The safety system uses a combination of:

- **Text Classification**: Machine learning-based classification to detect unsafe content
- **Keyword Matching**: Pattern-based matching against a configurable keyword list

## Safety Configuration Files

The safety system uses two configuration files:

1. **Keyword List** (`server/config/profanity.json`) - **Not included in repository** - You must create your own
2. **Safety Classifier Model** (`server/config/safety_classifier_model_weights.json`) - Included in repository

### Configuring Safety Keywords

By default, the safety system looks for a keyword list at `server/config/profanity.json`. This file is **not included in the repository** for privacy and security reasons. You must create your own keyword list.

### Step 1: Create Your Keyword List

1. Copy the template file:
   ```bash
   cp server/config/profanity.json.template server/config/profanity.json
   ```

2. Edit `server/config/profanity.json` and add your keywords as a JSON array:
   ```json
   [
     "keyword1",
     "keyword2",
     "keyword3"
   ]
   ```

### Step 2: Customize Paths (Optional)

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

