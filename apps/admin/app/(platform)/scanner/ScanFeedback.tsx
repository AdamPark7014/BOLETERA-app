'use client';

import type { ScanVerdict } from './types';
import styles from './scanner.module.scss';

export type FeedbackState = {
  verdict: ScanVerdict | 'idle';
  title: string;
  detail: string;
  code?: string;
};

type Props = {
  feedback: FeedbackState;
};

/** Banner de resultado con región live para lectores de pantalla. */
export function ScanFeedback({ feedback }: Props) {
  const toneClass =
    feedback.verdict === 'approved'
      ? styles.feedbackOk
      : feedback.verdict === 'rejected'
        ? styles.feedbackBad
        : feedback.verdict === 'queued'
          ? styles.feedbackQueued
          : styles.feedbackIdle;

  return (
    <div
      className={`${styles.feedback} ${toneClass}`}
      role="status"
      aria-live="assertive"
      aria-atomic="true"
    >
      <p className={styles.feedbackTitle}>{feedback.title}</p>
      {feedback.detail ? <p className={styles.feedbackDetail}>{feedback.detail}</p> : null}
      {feedback.code ? <code className={styles.feedbackCode}>{feedback.code}</code> : null}
    </div>
  );
}
