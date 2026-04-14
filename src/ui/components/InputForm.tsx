'use client';

import { useState, useRef, useCallback } from 'react';
import type { MemoInput } from '@/types/memo';

interface InputFormProps {
  onSubmit: (input: MemoInput) => void;
  isDisabled: boolean;
}

export default function InputForm({ onSubmit, isDisabled }: InputFormProps) {
  const [topic, setTopic] = useState('');
  const [background, setBackground] = useState('');
  const [knownSourcesRaw, setKnownSourcesRaw] = useState('');
  const [template, setTemplate] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [topicError, setTopicError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((): void => {
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files === null) return;
    const selected = Array.from(e.target.files);
    setFiles((prev) => [...prev, ...selected]);
  }, []);

  const removeFile = useCallback((index: number): void => {
    setFiles((prev) => prev.filter((_f, i) => i !== index));
  }, []);

  const handleFileButtonClick = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const handleSubmit = useCallback(
    (e: React.SyntheticEvent<HTMLFormElement>): void => {
      e.preventDefault();
      if (topic.trim().length === 0) {
        setTopicError(true);
        return;
      }
      setTopicError(false);
      const knownSources = knownSourcesRaw
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const input: MemoInput = {
        topic: topic.trim(),
        background: background.trim().length > 0 ? background.trim() : undefined,
        known_sources: knownSources.length > 0 ? knownSources : undefined,
        template: template.trim().length > 0 ? template.trim() : undefined,
        uploaded_files: files.length > 0 ? files : undefined,
      };
      onSubmit(input);
    },
    [topic, background, knownSourcesRaw, template, files, onSubmit],
  );

  const handleTopicChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => {
      setTopic(e.target.value);
      if (topicError && e.target.value.trim().length > 0) setTopicError(false);
    },
    [topicError],
  );

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Topic */}
      <div>
        <label
          htmlFor="topic"
          className="block text-sm font-semibold tracking-wide uppercase mb-1.5"
          style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
        >
          Policy Topic
        </label>
        <input
          id="topic"
          type="text"
          value={topic}
          onChange={handleTopicChange}
          disabled={isDisabled}
          placeholder="e.g. Universal basic income pilots in sub-Saharan Africa"
          aria-required="true"
          aria-invalid={topicError}
          className="w-full px-4 py-3 border rounded text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderColor: topicError ? '#dc2626' : 'var(--color-paper-dark)',
            backgroundColor: 'white',
            fontFamily: 'var(--font-sans)',
            outline: 'none',
          }}
        />
        {topicError && (
          <p className="mt-1 text-sm" style={{ color: '#dc2626', fontFamily: 'var(--font-sans)' }}>
            A policy topic is required.
          </p>
        )}
      </div>

      {/* Background */}
      <div>
        <label
          htmlFor="background"
          className="block text-sm font-semibold tracking-wide uppercase mb-1.5"
          style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
        >
          Background / Framing{' '}
          <span className="font-normal normal-case" style={{ color: 'var(--color-muted)' }}>
            (optional)
          </span>
        </label>
        <textarea
          id="background"
          value={background}
          onChange={(e) => {
            setBackground(e.target.value);
          }}
          disabled={isDisabled}
          rows={3}
          placeholder="Provide context for the memo — intended audience, decision timeline, key constraints."
          className="w-full px-4 py-3 border rounded text-base resize-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderColor: 'var(--color-paper-dark)',
            backgroundColor: 'white',
            fontFamily: 'var(--font-sans)',
          }}
        />
      </div>

      {/* Known Sources */}
      <div>
        <label
          htmlFor="known-sources"
          className="block text-sm font-semibold tracking-wide uppercase mb-1.5"
          style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
        >
          Known Sources{' '}
          <span className="font-normal normal-case" style={{ color: 'var(--color-muted)' }}>
            (optional)
          </span>
        </label>
        <textarea
          id="known-sources"
          value={knownSourcesRaw}
          onChange={(e) => {
            setKnownSourcesRaw(e.target.value);
          }}
          disabled={isDisabled}
          rows={3}
          placeholder={
            'One URL or source reference per line:\nhttps://arxiv.org/abs/2311.12345\nhttps://www.worldbank.org/report/...'
          }
          className="w-full px-4 py-3 border rounded text-sm resize-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-mono"
          style={{
            borderColor: 'var(--color-paper-dark)',
            backgroundColor: 'white',
          }}
        />
        <p
          className="mt-1 text-xs"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
        >
          The agent will consult these sources before searching elsewhere.
        </p>
      </div>

      {/* Template */}
      <div>
        <label
          htmlFor="template"
          className="block text-sm font-semibold tracking-wide uppercase mb-1.5"
          style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
        >
          Memo Template{' '}
          <span className="font-normal normal-case" style={{ color: 'var(--color-muted)' }}>
            (optional)
          </span>
        </label>
        <textarea
          id="template"
          value={template}
          onChange={(e) => {
            setTemplate(e.target.value);
          }}
          disabled={isDisabled}
          rows={3}
          placeholder={
            'Specify a structure, e.g.:\n1. Executive Summary\n2. Situation Analysis\n3. Policy Options\n4. Recommendations'
          }
          className="w-full px-4 py-3 border rounded text-base resize-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderColor: 'var(--color-paper-dark)',
            backgroundColor: 'white',
            fontFamily: 'var(--font-sans)',
          }}
        />
      </div>

      {/* File Upload */}
      <div>
        <p
          className="block text-sm font-semibold tracking-wide uppercase mb-1.5"
          style={{ color: 'var(--color-navy)', fontFamily: 'var(--font-sans)' }}
        >
          Source Documents{' '}
          <span className="font-normal normal-case" style={{ color: 'var(--color-muted)' }}>
            (optional)
          </span>
        </p>
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer"
          style={{
            borderColor: isDragging ? 'var(--color-gold)' : 'var(--color-paper-dark)',
            backgroundColor: isDragging ? 'rgba(226,176,74,0.05)' : 'white',
          }}
          onClick={handleFileButtonClick}
          role="button"
          tabIndex={0}
          aria-label="Upload source documents"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') handleFileButtonClick();
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.txt"
            onChange={handleFileInput}
            className="sr-only"
            aria-hidden="true"
          />
          <p
            className="text-sm"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
          >
            Drag &amp; drop PDFs or documents, or{' '}
            <span style={{ color: 'var(--color-gold)' }} className="font-semibold">
              click to browse
            </span>
          </p>
          <p
            className="text-xs mt-1"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-sans)' }}
          >
            Supports PDF, DOC, DOCX, TXT
          </p>
        </div>

        {files.length > 0 && (
          <ul className="mt-2 space-y-1">
            {files.map((file, i) => (
              <li
                key={`${file.name}-${i.toString()}`}
                className="flex items-center justify-between px-3 py-1.5 rounded text-sm"
                style={{
                  backgroundColor: 'var(--color-paper-dark)',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <span className="truncate" style={{ color: 'var(--color-navy)' }}>
                  {file.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    removeFile(i);
                  }}
                  className="ml-3 text-xs flex-shrink-0 hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-muted)' }}
                  aria-label={`Remove ${file.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={isDisabled}
        className="w-full py-4 text-base font-semibold tracking-wide transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          backgroundColor: 'var(--color-navy)',
          color: 'var(--color-gold)',
          fontFamily: 'var(--font-sans)',
          borderRadius: '2px',
          letterSpacing: '0.08em',
        }}
      >
        {isDisabled ? 'Generating…' : 'Generate Policy Memo'}
      </button>
    </form>
  );
}
