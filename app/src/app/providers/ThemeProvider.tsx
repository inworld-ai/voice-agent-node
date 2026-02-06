'use client';

import { ThemeProvider as MUIThemeProvider } from '@mui/material';
import { Toaster } from 'react-hot-toast';
import theme from '../../app/theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <MUIThemeProvider theme={theme}>
      {children}
      <Toaster position="top-right" />
    </MUIThemeProvider>
  );
}
