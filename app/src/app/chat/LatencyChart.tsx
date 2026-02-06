import { BarChart, Close, Speed } from '@mui/icons-material';
import { Box, Collapse, IconButton, Typography } from '@mui/material';
import { useState } from 'react';

import { InteractionLatency } from '../types';

interface LatencyChartProps {
  latencyData: InteractionLatency[];
}

export function LatencyChart(props: LatencyChartProps) {
  const { latencyData } = props;
  const [isExpanded, setIsExpanded] = useState(false);

  // Filter to only show interactions with calculated latency
  const completedLatencies = latencyData.filter(
    (item) => item.latencyMs !== undefined,
  );

  // Calculate statistics
  // Note: latencyMs is processing time (from speech complete event to first audio)
  // Total user experience = latencyMs + endpointingLatencyMs
  const latencies = completedLatencies.map((item) => item.latencyMs!);
  const avgProcessing =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

  // Calculate endpointing latency statistics
  const endpointingLatencies = completedLatencies.map(
    (item) => item.metadata?.endpointingLatencyMs || 0,
  );
  const avgEndpointing =
    endpointingLatencies.length > 0
      ? Math.round(
          endpointingLatencies.reduce((a, b) => a + b, 0) /
            endpointingLatencies.length,
        )
      : 0;

  // Total latency = processing + endpointing
  const avgLatency = avgProcessing + avgEndpointing;
  const totalLatencies = completedLatencies.map(
    (item) => item.latencyMs! + (item.metadata?.endpointingLatencyMs || 0),
  );
  const minLatency =
    totalLatencies.length > 0 ? Math.min(...totalLatencies) : 0;
  const maxLatency =
    totalLatencies.length > 0 ? Math.max(...totalLatencies) : 0;

  if (completedLatencies.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        position: 'fixed',
        top: '80px',
        right: '16px',
        zIndex: 20,
        maxWidth: isExpanded ? '400px' : '200px',
        transition: 'all 0.3s ease-in-out',
        display: { xs: 'none', md: 'block' }, // Hide on mobile, show on desktop
      }}
    >
      <Box
        sx={{
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.12)',
          border: '1px solid #E9E5E0',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            p: 2,
            backgroundColor: '#F8F9FA',
            borderBottom: '1px solid #E9E5E0',
            cursor: 'pointer',
          }}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Speed sx={{ fontSize: '18px', color: '#5C5652' }} />
            <Typography
              variant="subtitle2"
              sx={{
                fontFamily: 'Inter, Arial, sans-serif',
                fontWeight: 600,
                fontSize: '13px',
                color: '#222222',
              }}
            >
              Response Latency
            </Typography>
          </Box>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            sx={{ p: 0.5 }}
          >
            {isExpanded ? (
              <Close sx={{ fontSize: '16px', color: '#817973' }} />
            ) : (
              <BarChart sx={{ fontSize: '16px', color: '#817973' }} />
            )}
          </IconButton>
        </Box>

        {/* Summary Stats */}
        <Box sx={{ p: 2 }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-around',
              gap: 2,
            }}
          >
            <Box sx={{ textAlign: 'center' }}>
              <Typography
                variant="h5"
                sx={{
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontWeight: 700,
                  fontSize: '24px',
                  color: getLatencyColor(avgLatency),
                }}
              >
                {avgLatency}
              </Typography>
              <Typography
                variant="caption"
                sx={{
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontSize: '11px',
                  color: '#817973',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                Avg (ms)
              </Typography>
            </Box>
            {isExpanded && (
              <>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography
                    variant="h5"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontWeight: 700,
                      fontSize: '24px',
                      color: getLatencyColor(minLatency),
                    }}
                  >
                    {minLatency}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontSize: '11px',
                      color: '#817973',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Min (ms)
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography
                    variant="h5"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontWeight: 700,
                      fontSize: '24px',
                      color: getLatencyColor(maxLatency),
                    }}
                  >
                    {maxLatency}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontSize: '11px',
                      color: '#817973',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                    }}
                  >
                    Max (ms)
                  </Typography>
                </Box>
              </>
            )}
          </Box>
          {/* Latency breakdown - only show if we have endpointing data */}
          {isExpanded && avgEndpointing > 0 && (
            <Box
              sx={{
                mt: 2,
                pt: 2,
                borderTop: '1px solid #E9E5E0',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  fontFamily: 'Inter, Arial, sans-serif',
                  fontSize: '10px',
                  color: '#817973',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  display: 'block',
                  mb: 1,
                }}
              >
                Average Breakdown
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-around',
                  gap: 2,
                }}
              >
                <Box sx={{ textAlign: 'center', flex: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontWeight: 600,
                      fontSize: '16px',
                      color: '#817973',
                    }}
                  >
                    {avgEndpointing}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontSize: '10px',
                      color: '#817973',
                    }}
                  >
                    Endpointing (ms)
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'center', flex: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontWeight: 600,
                      fontSize: '16px',
                      color: '#5C5652',
                    }}
                  >
                    {avgProcessing}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontSize: '10px',
                      color: '#817973',
                    }}
                  >
                    Processing (ms)
                  </Typography>
                </Box>
              </Box>
            </Box>
          )}
        </Box>

        {/* Detailed Chart */}
        <Collapse in={isExpanded} timeout={300}>
          <Box
            sx={{
              p: 2,
              pt: 0,
              maxHeight: '400px',
              overflowY: 'auto',
              borderTop: '1px solid #E9E5E0',
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'Inter, Arial, sans-serif',
                fontSize: '11px',
                color: '#817973',
                mb: 1.5,
                display: 'block',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Interaction History
            </Typography>
            {completedLatencies.map((item, index) => {
              const endpointingLatencyMs =
                item.metadata?.endpointingLatencyMs || 0;
              const processingMs = item.latencyMs!;
              const totalMs = processingMs + endpointingLatencyMs;
              const maxBarLatency = Math.max(...totalLatencies);
              const widthPercent = (totalMs / maxBarLatency) * 100;

              return (
                <Box key={item.interactionId} sx={{ mb: 2 }}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 0.5,
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'Inter, Arial, sans-serif',
                        fontSize: '11px',
                        color: '#5C5652',
                        fontWeight: 500,
                      }}
                    >
                      #{index + 1}
                    </Typography>
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'Inter, Arial, sans-serif',
                        fontSize: '11px',
                        color: getLatencyColor(totalMs),
                        fontWeight: 600,
                      }}
                    >
                      {totalMs}ms
                    </Typography>
                  </Box>
                  {/* Bar Chart */}
                  <Box
                    sx={{
                      width: '100%',
                      height: '8px',
                      backgroundColor: '#F0F0F0',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      mb: 0.5,
                      position: 'relative',
                    }}
                  >
                    {/* Processing time (base) */}
                    <Box
                      sx={{
                        width: `${widthPercent}%`,
                        height: '100%',
                        backgroundColor: getLatencyColor(totalMs),
                        borderRadius: '4px',
                        transition: 'width 0.3s ease-in-out',
                        position: 'relative',
                      }}
                    >
                      {/* Endpointing latency overlay (if present) - on left to show chronological order */}
                      {endpointingLatencyMs > 0 && (
                        <Box
                          sx={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            height: '100%',
                            width: `${(endpointingLatencyMs / totalMs) * 100}%`,
                            backgroundColor: 'rgba(0, 0, 0, 0.2)',
                            borderRadius: '4px 0 0 4px',
                          }}
                        />
                      )}
                    </Box>
                  </Box>
                  {/* Latency breakdown */}
                  {endpointingLatencyMs > 0 ? (
                    <Typography
                      variant="caption"
                      sx={{
                        fontFamily: 'Inter, Arial, sans-serif',
                        fontSize: '10px',
                        color: '#817973',
                        display: 'block',
                        mb: 0.3,
                      }}
                    >
                      Endpointing: {endpointingLatencyMs}ms | Processing:{' '}
                      {processingMs}ms
                    </Typography>
                  ) : null}
                  {/* User text preview */}
                  <Typography
                    variant="caption"
                    sx={{
                      fontFamily: 'Inter, Arial, sans-serif',
                      fontSize: '10px',
                      color: '#817973',
                      fontStyle: 'italic',
                      display: 'block',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    "{item.userText}"
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
}

function getLatencyColor(latencyMs: number): string {
  if (latencyMs < 500) return '#10B981'; // Green - excellent
  if (latencyMs < 1000) return '#F59E0B'; // Amber - good
  if (latencyMs < 2000) return '#F97316'; // Orange - acceptable
  return '#EF4444'; // Red - slow
}
