import { Box, CssBaseline } from '@mui/material';
import { ReactNode } from 'react';

import { Header } from './Header';
import { Main } from './Main';

interface LayoutProps {
  children?: ReactNode;
  chatMode?: boolean;
}

export function Layout(props: LayoutProps) {
  return (
    <Box sx={{ height: '100vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <CssBaseline />
      <Header />
      {props.chatMode ? (
        // Chat mode: no wrapper, full height
        <Box sx={{ flex: 1, overflow: 'hidden' }}>{props.children}</Box>
      ) : (
        // Config mode: use Main wrapper with background
        <Box sx={{ flex: 1, overflow: 'auto', backgroundColor: '#FAF7F5' }}>
          <Main>
            <Box sx={{ maxWidth: '1200px', mx: 'auto' }}>{props.children}</Box>
          </Main>
        </Box>
      )}
    </Box>
  );
}
