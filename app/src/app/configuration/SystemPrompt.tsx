import { Box, TextField } from '@mui/material';
import { useCallback, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';

import { save as saveConfiguration } from '../helpers/configuration';
import { ConfigurationSession } from '../types';

const FIELD_NAME = 'agent.systemPrompt';

export const SystemPrompt = () => {
  const { getValues, formState, register, setValue } =
    useFormContext<ConfigurationSession>();

  const onChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setValue(FIELD_NAME, event.target.value);
      saveConfiguration(getValues());
    },
    [getValues, setValue],
  );

  const errorMessage = useMemo(
    () => formState.errors?.agent?.systemPrompt?.message,
    [formState],
  );

  return (
    <Box sx={{ m: 2 }}>
      <TextField
        fullWidth
        multiline
        rows={8}
        id="agent-system-prompt"
        label="System Prompt"
        placeholder="Enter system prompt"
        InputLabelProps={{ shrink: true }}
        {...{ error: !!errorMessage, helperText: errorMessage }}
        {...register(FIELD_NAME, {
          onChange,
          required: 'This field is required',
        })}
      />
    </Box>
  );
};
