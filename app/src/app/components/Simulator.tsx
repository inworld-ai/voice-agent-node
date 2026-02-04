import { styled } from '@mui/system';

const NAV_HEIGHT_XS = '3rem';
const TAB_BAR_HEIGHT = '3rem';

export const MainWrapper = styled('div')(({ theme }) => ({
  position: 'sticky',
  height: `calc(100vh -1.5rem)`,
  display: 'flex',
  flexDirection: 'column',
  [theme.breakpoints.only('sm')]: {
    paddingLeft: 0,
  },
  [theme.breakpoints.only('xs')]: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    paddingLeft: '0',
    paddingRight: '0',
    paddingBottom: TAB_BAR_HEIGHT,
  },
}));
export const ChatWrapper = styled('div')(({ theme }) => ({
  borderRadius: '1rem',
  overflow: 'hidden',
  backgroundColor: '#FFFFFF',
  height: `calc(100vh - 1.5rem)`,
  border: '1px solid #E9E5E0',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  display: 'flex',

  [theme.breakpoints.only('xs')]: {
    height: `calc(100vh - ${NAV_HEIGHT_XS} - ${TAB_BAR_HEIGHT})`,
    borderRadius: 0,
    border: 'none',
    flexDirection: 'column',
  },
}));

export const ChatMainArea = styled('div')(({ theme }) => ({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0, // Prevent flex item from overflowing

  [theme.breakpoints.only('xs')]: {
    flex: 1,
  },
}));

export const ChatSidebarArea = styled('div')(({ theme }) => ({
  width: '320px',
  borderLeft: '1px solid #E9E5E0',
  backgroundColor: '#FAF7F5',
  display: 'flex',
  flexDirection: 'column',

  [theme.breakpoints.only('xs')]: {
    width: '100%',
    borderLeft: 'none',
    borderTop: '1px solid #E9E5E0',
    height: '200px', // Fixed height on mobile
  },
}));

export const SimulatorHeader = styled('div')(({ theme }) => ({
  height: '4rem',
  backgroundColor: 'rgba(255, 255, 255, 0.95)',
  backdropFilter: 'blur(12px)',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'absolute',
  top: 0,
  left: 0,
  zIndex: 5,
  borderBottom: '1px solid #E9E5E0',
  fontFamily: 'Inter, Arial, sans-serif',
  [theme.breakpoints.only('xs')]: {
    height: 'auto',
    padding: '0.75rem',
  },
}));
