import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import type { CommandRegistry, FileIndex } from '@deepseek-code/core';
import { SuggestionMenu, type SuggestionItem } from './SuggestionMenu.js';

type MenuKind = 'none' | 'command' | 'model' | 'file' | 'memoryScope';

const MODEL_OPTIONS = ['deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner'];

export interface InputBoxProps {
  registry: CommandRegistry;
  fileIndex: FileIndex;
  history: string[];
  isRunning: boolean;
  onSubmit(input: string, attachments: string[]): void;
  onAbort(): void;
  onExit(): void;
  onMemoryAppend(scope: 'project' | 'user', text: string): void;
}

function currentToken(value: string, cursor: number): { start: number; end: number; text: string } {
  let start = cursor;
  while (start > 0 && !/\s/.test(value[start - 1])) start--;
  let end = cursor;
  while (end < value.length && !/\s/.test(value[end])) end++;
  return { start, end, text: value.slice(start, end) };
}

function detectMenu(value: string, cursor: number): { kind: MenuKind; query: string; tokenStart: number } {
  if (value.startsWith('#')) {
    return { kind: 'memoryScope', query: value.slice(1).trim(), tokenStart: 0 };
  }
  const tok = currentToken(value, cursor);
  if (tok.text.startsWith('@')) {
    return { kind: 'file', query: tok.text.slice(1), tokenStart: tok.start };
  }
  const trimmed = value.trimStart();
  if (trimmed.startsWith('/model ')) {
    return { kind: 'model', query: trimmed.slice(7).trim(), tokenStart: value.length - trimmed.slice(7).length };
  }
  if (trimmed.startsWith('/') && !trimmed.includes(' ')) {
    return { kind: 'command', query: trimmed.slice(1), tokenStart: 0 };
  }
  return { kind: 'none', query: '', tokenStart: 0 };
}

export function InputBox(props: InputBoxProps) {
  const { registry, fileIndex, history, isRunning, onSubmit, onAbort, onExit, onMemoryAppend } = props;

  const [value, setValue] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [historyPos, setHistoryPos] = useState(-1);
  const [draft, setDraft] = useState('');
  const [menuHidden, setMenuHidden] = useState(false);
  const [ctrlCArmed, setCtrlCArmed] = useState(false);

  const menu = useMemo(() => detectMenu(value, cursor), [value, cursor]);

  const items: SuggestionItem[] = useMemo(() => {
    if (menuHidden) return [];
    switch (menu.kind) {
      case 'command':
        return registry.filter(menu.query).slice(0, 8).map(({ cmd, matches }) => ({
          key: cmd.name,
          label: `/${cmd.name}`,
          hint: `${cmd.description}  [${cmd.source}]${cmd.argumentHint ? '  ' + cmd.argumentHint : ''}`,
          matches: matches.map((i) => i + 1),
        }));
      case 'model':
        return MODEL_OPTIONS
          .filter((m) => m.startsWith(menu.query))
          .map((m) => ({ key: m, label: m }));
      case 'file':
        return fileIndex.search(menu.query, 8).map((h) => ({
          key: h.path,
          label: '@' + h.path,
          matches: h.matches.map((i) => i + 1),
        }));
      case 'memoryScope':
        return [
          { key: 'project', label: '项目级', hint: 'DEEPSEEK.md（本仓库）' },
          { key: 'user', label: '用户级', hint: '~/.deepseek-code/DEEPSEEK.md（所有项目）' },
        ];
      default:
        return [];
    }
  }, [menu, registry, fileIndex, menuHidden]);

  useEffect(() => {
    if (selectedIdx >= items.length) setSelectedIdx(0);
  }, [items.length, selectedIdx]);

  useEffect(() => {
    setMenuHidden(false);
  }, [value, cursor]);

  const applySelection = useCallback(() => {
    if (items.length === 0) return;
    const it = items[selectedIdx];
    switch (menu.kind) {
      case 'command': {
        const v = it.label + ' ';
        setValue(v);
        setCursor(v.length);
        break;
      }
      case 'model': {
        const v = '/model ' + it.key;
        setValue(v);
        setCursor(v.length);
        break;
      }
      case 'file': {
        const before = value.slice(0, menu.tokenStart);
        const after = value.slice(cursor);
        const inserted = '@' + it.key + ' ';
        const nv = before + inserted + after;
        setValue(nv);
        setCursor((before + inserted).length);
        break;
      }
      case 'memoryScope': {
        const text = value.slice(1).trim();
        if (text) onMemoryAppend(it.key as 'project' | 'user', text);
        setValue(''); setCursor(0);
        break;
      }
    }
    setSelectedIdx(0);
  }, [items, selectedIdx, menu, value, cursor, onMemoryAppend]);

  const commit = useCallback((raw: string) => {
    const attachments: string[] = [];
    for (const m of raw.matchAll(/@([^\s]+)/g)) attachments.push(m[1]);
    onSubmit(raw, attachments);
    setValue(''); setCursor(0);
    setSelectedIdx(0);
    setHistoryPos(-1);
    setDraft('');
  }, [onSubmit]);

  useInput((input, key) => {
    if (ctrlCArmed && !(key.ctrl && input === 'c')) setCtrlCArmed(false);

    if (isRunning) {
      if (key.escape || (key.ctrl && input === 'c')) onAbort();
      return;
    }

    // menu navigation
    if (items.length > 0) {
      if (key.upArrow) { setSelectedIdx((i) => Math.max(0, i - 1)); return; }
      if (key.downArrow) { setSelectedIdx((i) => Math.min(items.length - 1, i + 1)); return; }
      if (key.tab) { applySelection(); return; }
      if (key.escape) { setMenuHidden(true); return; }
    } else {
      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyPos === -1) setDraft(value);
        const newIdx = historyPos === -1 ? history.length - 1 : Math.max(0, historyPos - 1);
        setHistoryPos(newIdx);
        const v = history[newIdx];
        setValue(v); setCursor(v.length);
        return;
      }
      if (key.downArrow) {
        if (historyPos === -1) return;
        const newIdx = historyPos + 1;
        if (newIdx >= history.length) {
          setHistoryPos(-1);
          setValue(draft); setCursor(draft.length);
        } else {
          setHistoryPos(newIdx);
          const v = history[newIdx];
          setValue(v); setCursor(v.length);
        }
        return;
      }
    }

    if (key.escape) { setValue(''); setCursor(0); return; }

    if (key.ctrl && input === 'c') {
      if (value === '') {
        if (ctrlCArmed) { onExit(); return; }
        setCtrlCArmed(true);
        return;
      }
      setValue(''); setCursor(0);
      return;
    }
    if (key.ctrl && input === 'd' && value === '') { onExit(); return; }

    if (key.leftArrow) { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.rightArrow) { setCursor((c) => Math.min(value.length, c + 1)); return; }
    if (key.ctrl && input === 'a') { setCursor(0); return; }
    if (key.ctrl && input === 'e') { setCursor(value.length); return; }
    if (key.ctrl && input === 'u') {
      setValue(value.slice(cursor)); setCursor(0); return;
    }
    if (key.ctrl && input === 'k') {
      setValue(value.slice(0, cursor)); return;
    }
    if (key.ctrl && input === 'w') {
      let i = cursor - 1;
      while (i >= 0 && value[i] === ' ') i--;
      while (i >= 0 && value[i] !== ' ') i--;
      setValue(value.slice(0, i + 1) + value.slice(cursor));
      setCursor(i + 1);
      return;
    }
    if (key.backspace || key.delete) {
      // ink v5: delete flag can mean backspace on some terms
      if (cursor === 0) return;
      setValue(value.slice(0, cursor - 1) + value.slice(cursor));
      setCursor(cursor - 1);
      return;
    }

    if (key.return) {
      if (items.length > 0) {
        if (menu.kind === 'memoryScope') applySelection();
        else applySelection();
        return;
      }
      const trimmed = value.trim();
      if (trimmed) commit(trimmed);
      return;
    }

    if (input && !key.ctrl && !key.meta) {
      const nv = value.slice(0, cursor) + input + value.slice(cursor);
      setValue(nv);
      setCursor(cursor + input.length);
    }
  });

  const beforeCursor = value.slice(0, cursor);
  const atCursor = value[cursor] ?? ' ';
  const afterCursor = value.slice(cursor + 1);
  const argHint = useMemo(() => {
    if (menu.kind !== 'none') return '';
    const trimmed = value.trimStart();
    if (!trimmed.startsWith('/')) return '';
    const sp = trimmed.indexOf(' ');
    if (sp === -1) return '';
    const name = trimmed.slice(1, sp);
    const cmd = registry.resolve(name);
    if (!cmd?.argumentHint) return '';
    const argPart = trimmed.slice(sp + 1);
    return argPart ? '' : cmd.argumentHint;
  }, [value, menu.kind, registry]);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">{isRunning ? '⏸ ' : '> '}</Text>
        <Text>{beforeCursor}</Text>
        <Text inverse>{atCursor}</Text>
        <Text>{afterCursor}</Text>
        {argHint && <Text color="gray">  {argHint}</Text>}
        {isRunning && (
          <Text color="gray">  <Spinner type="dots" /> running · Esc to abort</Text>
        )}
        {ctrlCArmed && !isRunning && <Text color="yellow">  再按一次 Ctrl+C 退出</Text>}
      </Box>
      {!isRunning && items.length > 0 && (
        <SuggestionMenu
          items={items}
          selectedIndex={selectedIdx}
          footer="↑↓ 选择 · Enter/Tab 补全 · Esc 关闭"
        />
      )}
    </Box>
  );
}
