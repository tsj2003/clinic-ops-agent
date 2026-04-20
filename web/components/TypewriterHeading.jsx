'use client';

import { useEffect, useState } from 'react';

export default function TypewriterHeading({ text = '', className = '', speed = 60, startDelay = 400 }) {
  const [displayedText, setDisplayedText] = useState('');
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    setDisplayedText('');
    setIsTyping(true);

    if (!text) {
      setIsTyping(false);
      return undefined;
    }

    let index = 0;
    let intervalId;

    const startTimer = window.setTimeout(() => {
      intervalId = window.setInterval(() => {
        index += 1;
        setDisplayedText(text.slice(0, index));
        if (index >= text.length) {
          window.clearInterval(intervalId);
          setIsTyping(false);
        }
      }, speed);
    }, startDelay);

    return () => {
      window.clearTimeout(startTimer);
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [startDelay, speed, text]);

  return (
    <h1 className={className} aria-label={text}>
      <span>{displayedText || text}</span>
      {isTyping && (
        <span
          className="inline-block w-[3px] h-[1.1em] bg-red-500 ml-1 align-middle"
          style={{ animation: 'blink 0.7s step-end infinite' }}
        />
      )}
    </h1>
  );
}
