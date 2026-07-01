import React from 'react';
import { Box, Text } from 'ink';

export interface SuggestionItem {
  key: string;
  label: string;
  hint?: string;
  matches?: number[];
}

export interface SuggestionMenuProps {
  items: SuggestionItem[];
  selectedIndex: number;
  footer?: string;
}

function HighlightedLabel({ label, matches }: { label: string; matches?: number[] }) {
  if (!matches || matches.length === 0) return <Text>{label}</Text>;
  const set = new Set(matches);
  return (
    <Text>
      {[...label].map((ch, i) =>
        set.has(i) ? (
          <Text key={i} color="cyan" bold>{ch}</Text>
        ) : (
          <Text key={i}>{ch}</Text>
        ),
      )}
    </Text>
  );
}

export function SuggestionMenu({ items, selectedIndex, footer }: SuggestionMenuProps) {
  if (items.length === 0) return null;
  return (
    <Box flexDirection="column">
      {items.map((it, i) => {
        const selected = i === selectedIndex;
        return (
          <Box key={it.key}>
            <Text color={selected ? 'black' : 'white'} backgroundColor={selected ? 'cyan' : undefined}>
              {selected ? '▶ ' : '  '}
            </Text>
            <HighlightedLabel label={it.label} matches={it.matches} />
            {it.hint && <Text color="gray">  {it.hint}</Text>}
          </Box>
        );
      })}
      {footer && <Text color="gray">  {footer}</Text>}
    </Box>
  );
}
