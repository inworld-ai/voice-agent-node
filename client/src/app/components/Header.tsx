import { Box, Typography } from '@mui/material';

export function Header() {
  return (
    <Box
      component="header"
      sx={{
        width: '100%',
        py: 2.5,
        px: 3,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E9E5E0',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.02)',
      }}
    >
      {/* App Title - Left Side */}
      <Typography
        variant="h6"
        sx={{
          fontWeight: 600,
          fontSize: '20px',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          color: '#0a0a0a',
          letterSpacing: '-0.02em',
        }}
      >
        Voice Agent
      </Typography>

      {/* Inworld AI Logo - Right Side */}
      <Box
        component="a"
        href="https://inworld.ai/"
        target="_blank"
        rel="noopener noreferrer"
        sx={{
          display: 'flex',
          alignItems: 'center',
          textDecoration: 'none',
          transition: 'opacity 0.2s ease',
          '&:hover': {
            opacity: 0.8,
          },
        }}
      >
        {/* SVG Logo */}
        <Box
          component="img"
          src="/inworld.svg"
          alt="Inworld AI"
          sx={{
            height: 32,
            width: 'auto',
          }}
        />
      </Box>
    </Box>
  );
}
