import { getNonce } from "get-nonce";
import * as Select from "@radix-ui/react-select";
import {
  IconActivity,
  IconHistory,
  IconMessage,
  IconClipboardCheck,
  IconPlayerPlayFilled,
  IconCopy,
  IconUsers,
  IconSettings,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconChevronDown,
  IconCheck,
  IconMicrophone,
  IconMicrophoneOff,
  IconVideo,
  IconVideoOff,
  IconVolume,
  IconLink,
  IconFileText,
  IconX,
  IconPlayerPlay,
  IconPlayerStopFilled,
  IconSparkles,
  IconUpload,
  IconAlertCircle,
} from "@tabler/icons-react";
import type { ButtonHTMLAttributes } from "react";
// Google Material Icons Round: call_end (Apache-2.0).
// https://github.com/google/material-design-icons/blob/master/src/communication/call_end/materialiconsround/24px.svg
function CallEndIcon({ className }: { className?: string; stroke?: number }) {
  return <svg className={className} aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M4.51 15.48l2-1.59c.48-.38.76-.96.76-1.57v-2.6c3.02-.98 6.29-.99 9.32 0v2.61c0 .61.28 1.19.76 1.57l1.99 1.58c.8.63 1.94.57 2.66-.15l1.22-1.22c.8-.8.8-2.13-.05-2.88-6.41-5.66-16.07-5.66-22.48 0-.85.75-.85 2.08-.05 2.88l1.22 1.22c.71.72 1.85.78 2.65.15z"/></svg>;
}
const icons = {
  history: IconHistory,
  chat: IconMessage,
  scorecard: IconClipboardCheck,
  playFilled: IconPlayerPlayFilled,
  copy: IconCopy,
  users: IconUsers,
  settings: IconSettings,
  sidebarClose: IconLayoutSidebarRightCollapse,
  sidebarOpen: IconLayoutSidebarRightExpand,
  wave: IconActivity,
  chevron: IconChevronDown,
  check: IconCheck,
  mic: IconMicrophone,
  micOff: IconMicrophoneOff,
  camera: IconVideo,
  cameraOff: IconVideoOff,
  volume: IconVolume,
  link: IconLink,
  phone: CallEndIcon,
  file: IconFileText,
  close: IconX,
  play: IconPlayerPlay,
  stop: IconPlayerStopFilled,
  sparkles: IconSparkles,
  upload: IconUpload,
  alert: IconAlertCircle,
};
export function Icon({ name }: { name: keyof typeof icons }) {
  const Component = icons[name];
  return <Component className="icon" aria-hidden stroke={1.7} />;
}
export function IconButton({
  icon,
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: keyof typeof icons;
  label: string;
}) {
  return (
    <button
      type="button"
      className="control"
      data-tooltip=""
      aria-label={label}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}
export function FieldSelect({
  id,
  value,
  onChange,
  options,
  disabled = false,
  label = "Interview style",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  label?: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
      <Select.Trigger id={id} className="profile-trigger" aria-label={label}>
        <Select.Value />
        <Select.Icon>
          <Icon name="chevron" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="react-select"
          position="popper"
          sideOffset={8}
          collisionPadding={16}
        >
          <Select.Viewport nonce={getNonce()}>
            {options.map((option) => (
              <Select.Item
                className="react-option"
                key={option.value}
                value={option.value}
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator className="select-check">
                  <Icon name="check" />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
export const programs = [
  { value: "speedrun-10", label: "Speedrun" },
  { value: "yc-10", label: "YC" },
  { value: "speedrun-10-hard", label: "Speedrun · hard" },
];
export function Legal({ join = false }: { join?: boolean }) {
  return (
    <p className="consent-footnote">
      By {join ? "joining" : "creating a room"}, you agree to the{" "}
      <a href="/terms" target="_blank" rel="noreferrer">
        Terms
      </a>{" "}
      and acknowledge the{" "}
      <a href="/privacy" target="_blank" rel="noreferrer">
        Privacy Policy
      </a>
      .
    </p>
  );
}
export function ErrorText({
  id,
  children,
}: {
  id?: string;
  children?: string;
}) {
  return children ? (
    <p id={id} className="inline-error" role="alert">
      {children}
    </p>
  ) : null;
}
