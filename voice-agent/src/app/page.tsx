"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as chrono from "chrono-node";
import styles from "./page.module.css";

type Role = "user" | "agent";

type Message = {
  id: string;
  role: Role;
  content: string;
};

type Appointment = {
  id: string;
  attendee: string;
  datetime: Date;
  notes?: string;
  createdAt: Date;
};

type PendingBooking = {
  attendee?: string;
  datetime?: Date;
  notes?: string;
  rescheduleId?: string;
};

type ProcessContext = {
  appointments: Appointment[];
  pending: PendingBooking | null;
};

type ProcessOutcome = {
  reply: string;
  appointments: Appointment[];
  pending: PendingBooking | null;
};


interface RecognitionAlternative {
  transcript: string;
}

interface RecognitionResult {
  readonly 0: RecognitionAlternative;
  readonly length: number;
  readonly isFinal: boolean;
}

interface RecognitionResultList {
  readonly length: number;
  [index: number]: RecognitionResult;
}

interface RecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: RecognitionResultList;
}

interface RecognitionErrorEvent extends Event {
  readonly error:
    | "no-speech"
    | "aborted"
    | "audio-capture"
    | "network"
    | "not-allowed"
    | "service-not-allowed"
    | "bad-grammar"
    | "language-not-supported"
    | string;
}

interface BrowserSpeechRecognition {
  lang: string;
  maxAlternatives: number;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
    SpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const bookingVerbs = [
  "book",
  "schedule",
  "set up",
  "setup",
  "arrange",
  "organize",
  "plan",
  "make",
  "need",
  "want",
  "create",
];

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const getMissingField = (
  booking: PendingBooking,
): "attendee" | "datetime" | null => {
  if (!booking.attendee) {
    return "attendee";
  }

  if (!booking.datetime) {
    return "datetime";
  }

  return null;
};

const containsScheduleIntent = (text: string) => {
  const lower = text.toLowerCase();
  const mentionsMeeting = /(call|meeting|appointment|chat|catch[-\s]?up)/.test(
    lower,
  );
  const hasVerb = bookingVerbs.some((verb) => lower.includes(verb));
  const hasWith = /\bwith\s+\w+/.test(lower);
  const hasTemporalHint = /\b(today|tomorrow|tonight|morning|afternoon|evening|next|am|pm|\d{1,2}[:.]\d{0,2})\b/.test(
    lower,
  );
  return (mentionsMeeting && (hasVerb || hasWith || hasTemporalHint)) || false;
};

const extractDateTimeDetails = (input: string) => {
  const [result] = chrono.parse(input, new Date(), { forwardDate: true });
  if (!result) {
    return undefined;
  }

  return {
    date: result.date(),
    text: result.text,
  };
};

const formatName = (raw: string) => {
  const cleaned = raw
    .replace(/\b(call|meeting|appointment|demo|chat)\b/gi, " ")
    .replace(/[^a-z\s\-'.]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return undefined;
  }

  return cleaned
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
};

const extractAttendee = (input: string, exclude: string[] = []) => {
  let working = input;

  exclude.forEach((segment) => {
    if (segment) {
      working = working.replace(segment, " ");
    }
  });

  const withMatch = working.match(
    /\bwith\s+([a-z0-9\s\-'\.]+?)(?=\s+(?:about|regarding|at|on)\b|[,.!?]|$)/i,
  );

  if (withMatch) {
    return formatName(withMatch[1]);
  }

  const callMatch = working.match(
    /\bcall\s+([a-z0-9\s\-'\.]+?)(?=\s+(?:about|regarding|at|on)\b|[,.!?]|$)/i,
  );

  if (callMatch) {
    return formatName(callMatch[1]);
  }

  return undefined;
};

const extractNotes = (input: string, exclude: string[] = []) => {
  let working = input;
  exclude.forEach((segment) => {
    if (segment) {
      working = working.replace(segment, " ");
    }
  });

  const aboutMatch = working.match(/\b(?:about|regarding)\s+([^.,!?]+)/i);
  if (!aboutMatch) {
    return undefined;
  }

  const note = aboutMatch[1].replace(/\s+/g, " ").trim();
  if (!note) {
    return undefined;
  }

  return note.charAt(0).toUpperCase() + note.slice(1);
};

const findAppointmentByName = (appointments: Appointment[], query: string) => {
  const normalized = query.toLowerCase();
  return appointments.find((appt) =>
    appt.attendee.toLowerCase().includes(normalized),
  );
};

const findAppointmentByDate = (appointments: Appointment[], date: Date) => {
  return appointments.find(
    (appt) => Math.abs(appt.datetime.getTime() - date.getTime()) <= 45 * 60000,
  );
};

const sortAppointments = (appointments: Appointment[]) =>
  [...appointments].sort(
    (a, b) => a.datetime.getTime() - b.datetime.getTime(),
  );

const finalizeBooking = (
  draft: PendingBooking,
  context: ProcessContext,
  formatDate: (date: Date) => string,
): ProcessOutcome => {
  const targetDate = draft.datetime!;
  const targetName = draft.attendee!;
  const pendingNotes = draft.notes?.trim() || undefined;

  if (draft.rescheduleId) {
    const target = context.appointments.find(
      (appt) => appt.id === draft.rescheduleId,
    );

    if (!target) {
      return {
        reply:
          "I couldn't find that meeting anymore. Let's start over with the new details.",
        appointments: context.appointments,
        pending: null,
      };
    }

    const updated: Appointment[] = context.appointments.map((appt) =>
      appt.id === draft.rescheduleId
        ? {
            ...appt,
            attendee: targetName,
            datetime: targetDate,
            notes: pendingNotes ?? appt.notes,
          }
        : appt,
    );

    return {
      reply: `Got it. I've moved your call with ${targetName} to ${formatDate(targetDate)}.`,
      appointments: sortAppointments(updated),
      pending: null,
    };
  }

  const conflict = findAppointmentByDate(context.appointments, targetDate);
  if (conflict) {
    return {
      reply: `You already have ${conflict.attendee} at ${formatDate(conflict.datetime)}. Want to pick another time?`,
      appointments: context.appointments,
      pending: { ...draft, datetime: undefined },
    };
  }

  const appointment: Appointment = {
    id: generateId(),
    attendee: targetName,
    datetime: targetDate,
    notes: pendingNotes,
    createdAt: new Date(),
  };

  const updated = sortAppointments([...context.appointments, appointment]);
  const summary =
    `All set. I've scheduled a call with ${targetName} for ${formatDate(targetDate)}` +
    (pendingNotes ? ` about ${pendingNotes}.` : ".");

  return {
    reply: summary,
    appointments: updated,
    pending: null,
  };
};

const processMessage = (
  raw: string,
  context: ProcessContext,
  formatDate: (date: Date) => string,
): ProcessOutcome => {
  const text = raw.trim();
  if (!text) {
    return {
      reply: "I didn't catch that. Could you try again?",
      appointments: context.appointments,
      pending: context.pending,
    };
  }

  const lower = text.toLowerCase();

  if (context.pending) {
    if (/\b(cancel|never mind|nevermind|stop)\b/.test(lower)) {
      return {
        reply: "No problem, I won't make any changes.",
        appointments: context.appointments,
        pending: null,
      };
    }

    const merged: PendingBooking = { ...context.pending };
    const dateDetails = extractDateTimeDetails(text);
    const attendeeFromInput = extractAttendee(text, [
      dateDetails?.text ?? "",
    ]);
    const notesFromInput = extractNotes(text, [
      dateDetails?.text ?? "",
      attendeeFromInput ?? "",
    ]);

    if (!merged.attendee) {
      if (attendeeFromInput) {
        merged.attendee = attendeeFromInput;
      } else {
        const fallback = formatName(text);
        if (fallback) {
          merged.attendee = fallback;
        }
      }
    }

    if (!merged.datetime && dateDetails) {
      merged.datetime = dateDetails.date;
    }

    if (notesFromInput) {
      merged.notes = notesFromInput;
    }

    const missing = getMissingField(merged);

    if (missing) {
      const prompt =
        missing === "attendee"
          ? "Who should I set the call with?"
          : "What date and time works for that call?";
      return {
        reply: prompt,
        appointments: context.appointments,
        pending: merged,
      };
    }

    return finalizeBooking(merged, context, formatDate);
  }

  if (/\bhelp\b/.test(lower)) {
    return {
      reply:
        "You can ask me to book, list, reschedule, or cancel calls. Try something like “Book a call with Priya tomorrow at 2pm” or “Reschedule my demo with James to Friday morning.”",
      appointments: context.appointments,
      pending: null,
    };
  }

  if (
    (/(show|list|review|what).*appointments/.test(lower) ||
      /(show|list|review).*schedule/.test(lower) ||
      lower.includes("upcoming calls")) &&
    context.appointments.length
  ) {
    const lines = context.appointments.map((appt) => {
      const details =
        `• ${appt.attendee} — ${formatDate(appt.datetime)}` +
        (appt.notes ? ` (${appt.notes})` : "");
      return details;
    });

    return {
      reply: `Here's what's coming up:\n${lines.join("\n")}`,
      appointments: context.appointments,
      pending: null,
    };
  }

  if (
    (/(show|list|review|what).*appointments/.test(lower) ||
      /(show|list|review).*schedule/.test(lower)) &&
    context.appointments.length === 0
  ) {
    return {
      reply: "Your calendar is wide open — no calls booked yet.",
      appointments: context.appointments,
      pending: null,
    };
  }

  if (/\b(cancel|remove|delete|clear)\b/.test(lower)) {
    const dateDetails = extractDateTimeDetails(text);
    const attendee = extractAttendee(text, [dateDetails?.text ?? ""]);
    let target =
      (attendee && findAppointmentByName(context.appointments, attendee)) ||
      (dateDetails &&
        findAppointmentByDate(context.appointments, dateDetails.date));

    if (!target && context.appointments.length === 1) {
      target = context.appointments[0];
    }

    if (!target) {
      return {
        reply:
          "I couldn't find a matching appointment to cancel. Try mentioning who it's with or when it is.",
        appointments: context.appointments,
        pending: null,
      };
    }

    const updated = context.appointments.filter(
      (appt) => appt.id !== target!.id,
    );

    return {
      reply: `Done. I've canceled your call with ${target.attendee} on ${formatDate(target.datetime)}.`,
      appointments: updated,
      pending: null,
    };
  }

  if (/\b(reschedule|move|shift|push back|change)\b/.test(lower)) {
    const dateDetails = extractDateTimeDetails(text);
    const attendee = extractAttendee(text, [dateDetails?.text ?? ""]);
    let target =
      (attendee && findAppointmentByName(context.appointments, attendee)) ||
      (dateDetails &&
        findAppointmentByDate(context.appointments, dateDetails.date));

    if (!target && context.appointments.length === 1) {
      target = context.appointments[0];
    }

    if (!target) {
      return {
        reply:
          "I couldn't tell which meeting to move. Let me know who it's with or the original time.",
        appointments: context.appointments,
        pending: null,
      };
    }

    if (!dateDetails) {
      return {
        reply: `Sure, what new time works for your call with ${target.attendee}?`,
        appointments: context.appointments,
        pending: {
          attendee: target.attendee,
          notes: target.notes,
          rescheduleId: target.id,
        },
      };
    }

    return finalizeBooking(
      {
        attendee: target.attendee,
        datetime: dateDetails.date,
        notes: target.notes,
        rescheduleId: target.id,
      },
      context,
      formatDate,
    );
  }

  const dateDetails = extractDateTimeDetails(text);
  const attendee = extractAttendee(text, [dateDetails?.text ?? ""]);
  const notes = extractNotes(text, [
    dateDetails?.text ?? "",
    attendee ?? "",
  ]);

  const draft: PendingBooking = {
    attendee: attendee ?? undefined,
    datetime: dateDetails?.date,
    notes: notes ?? undefined,
  };

  if (containsScheduleIntent(text) || draft.attendee || draft.datetime) {
    const missing = getMissingField(draft);

    if (missing) {
      const prompt =
        missing === "attendee"
          ? "Sure — who should I book the call with?"
          : "Great. What date and time should I set?";
      return {
        reply: prompt,
        appointments: context.appointments,
        pending: draft,
      };
    }

    return finalizeBooking(draft, context, formatDate);
  }

  if (/\b(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(lower)) {
    return {
      reply:
        "Hi there! I can help you book, reschedule, or cancel calls whenever you're ready.",
      appointments: context.appointments,
      pending: null,
    };
  }

  return {
    reply:
      "I'm here to manage your calls. Ask me to book a meeting, reschedule one, or review your upcoming schedule.",
    appointments: context.appointments,
    pending: context.pending,
  };
};

const introMessage: Message = {
  id: generateId(),
  role: "agent",
  content:
    "Hi, I'm CallFlow. Tell me who you need to speak with and when, and I'll handle the scheduling.",
};

const suggestionPresets = [
  "Book a call with Jamie tomorrow at 9am about onboarding",
  "Reschedule my chat with Alex to Friday at 2pm",
  "List my upcoming appointments",
];

export default function Home() {
  const [messages, setMessages] = useState<Message[]>([introMessage]);
  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    if (typeof window === "undefined") {
      return [];
    }
    const stored = window.localStorage.getItem("callflow-appointments");
    if (!stored) {
      return [];
    }
    try {
      const parsed = JSON.parse(stored) as Appointment[];
      return sortAppointments(
        parsed.map((item) => ({
          ...item,
          datetime: new Date(item.datetime),
          createdAt: new Date(item.createdAt),
        })),
      );
    } catch {
      return [];
    }
  });
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(
    null,
  );
  const [inputValue, setInputValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [voicePlayback, setVoicePlayback] = useState(true);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  const formatDate = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return (date: Date) => formatter.format(date);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      "callflow-appointments",
      JSON.stringify(appointments),
    );
  }, [appointments]);

  useEffect(() => {
    if (!chatBodyRef.current) {
      return;
    }
    chatBodyRef.current.scrollTo({
      top: chatBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "agent") {
      return;
    }

    if (!voicePlayback) {
      return;
    }

    if (typeof window === "undefined" || !window.speechSynthesis) {
      return;
    }

    const utterance = new SpeechSynthesisUtterance(
      lastMessage.content.replace(/\n/g, ". "),
    );
    utterance.rate = 1.05;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [messages, voicePlayback]);

  useEffect(
    () => () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      recognitionRef.current?.stop();
    },
    [],
  );

  const handleSend = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return;
      }

      setInputValue("");

      const userMessage: Message = {
        id: generateId(),
        role: "user",
        content: trimmed,
      };

      const outcome = processMessage(trimmed, {
        appointments,
        pending: pendingBooking,
      }, formatDate);

      setAppointments(outcome.appointments);
      setPendingBooking(outcome.pending);

      const agentMessage: Message = {
        id: generateId(),
        role: "agent",
        content: outcome.reply,
      };

      setMessages((prev) => [...prev, userMessage, agentMessage]);
    },
    [appointments, pendingBooking, formatDate],
  );

  const toggleListening = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const SpeechRecognitionCtor =
      (window.SpeechRecognition ||
        window.webkitSpeechRecognition) as SpeechRecognitionConstructor | undefined;

    if (!SpeechRecognitionCtor) {
      setSpeechError(
        "Your browser doesn't support speech recognition. Try Chrome or Edge.",
      );
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: RecognitionEvent) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      setInputValue(transcript.trimStart());

      if (event.results[event.results.length - 1].isFinal) {
        const finalTranscript = transcript.trim();
        recognition.stop();
        setTimeout(() => {
          if (finalTranscript) {
            handleSend(finalTranscript);
          }
        }, 0);
      }
    };

    recognition.onerror = (event: RecognitionErrorEvent) => {
      setSpeechError(
        event.error === "not-allowed"
          ? "Microphone access was blocked."
          : "I couldn't understand that audio. Try again?",
      );
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setSpeechError(null);
    setIsListening(true);
    recognition.start();
  }, [handleSend, isListening]);

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      handleSend(inputValue);
    },
    [handleSend, inputValue],
  );

  const upcomingAppointments = appointments.slice(0, 5);

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.chatPanel}>
          <header className={styles.header}>
            <div>
              <h1>CallFlow Voice Agent</h1>
              <p>
                Book and manage your calls by typing or speaking naturally.
                I&apos;ll take care of the scheduling.
              </p>
            </div>
            <div className={styles.controls}>
              <button
                type="button"
                className={styles.voiceToggle}
                onClick={() => {
                  if (typeof window !== "undefined" && window.speechSynthesis) {
                    window.speechSynthesis.cancel();
                  }
                  setVoicePlayback((prev) => !prev);
                }}
              >
                {voicePlayback ? "Mute Agent" : "Unmute Agent"}
              </button>
              <button
                type="button"
                className={`${styles.micButton} ${
                  isListening ? styles.micActive : ""
                }`}
                onClick={toggleListening}
              >
                {isListening ? "Listening…" : "Speak"}
              </button>
            </div>
          </header>

          <div className={styles.suggestionRow}>
            {suggestionPresets.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className={styles.suggestion}
                onClick={() => handleSend(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>

          <div className={styles.log} ref={chatBodyRef}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`${styles.message} ${
                  message.role === "agent" ? styles.agent : styles.user
                }`}
              >
                {message.content.split("\n").map((chunk) => (
                  <p key={chunk}>{chunk}</p>
                ))}
              </div>
            ))}
          </div>

          {speechError ? (
            <div className={styles.speechWarning}>{speechError}</div>
          ) : null}

          <form className={styles.composer} onSubmit={handleSubmit}>
            <textarea
              placeholder="Type your request…"
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              rows={2}
            />
            <div className={styles.composerActions}>
              <button type="submit" className={styles.sendButton}>
                Send
              </button>
            </div>
          </form>
        </section>

        <aside className={styles.sidebar}>
          <h2>Upcoming Calls</h2>
          {upcomingAppointments.length === 0 ? (
            <p className={styles.emptyState}>
              No calls yet. Ask me to schedule one!
            </p>
          ) : (
            <ul className={styles.appointmentList}>
              {upcomingAppointments.map((appt) => (
                <li key={appt.id}>
                  <div className={styles.appointmentWhen}>
                    {formatDate(appt.datetime)}
                  </div>
                  <div className={styles.appointmentWith}>{appt.attendee}</div>
                  {appt.notes ? (
                    <div className={styles.appointmentNotes}>{appt.notes}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {appointments.length > 5 ? (
            <p className={styles.moreHint}>
              {appointments.length - 5} more scheduled — ask me to list them all.
            </p>
          ) : null}
        </aside>
      </main>
    </div>
  );
}
