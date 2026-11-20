"use client";

export function PanelLeftToggle({
  isOpen,
  size = 17,
  className = "",
}: {
  isOpen: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {isOpen && (
        <path
          d="M5 3h4v18H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
          fill="currentColor"
          stroke="none"
        />
      )}
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

export function PanelRightToggle({
  isOpen,
  size = 17,
  className = "",
}: {
  isOpen: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {isOpen && (
        <path
          d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4z"
          fill="currentColor"
          stroke="none"
        />
      )}
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </svg>
  );
}

