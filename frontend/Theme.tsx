import { createElement, useSyncExternalStore } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Icon, IconButton } from "./ui";
declare global {
  interface Window {
    mpTheme: { choice: string; resolved: string; set(value: string): void };
  }
}
export function ThemeToggle() {
  return createElement("theme-toggle", { class: "page-theme-toggle" });
}
const subscribe = (callback: () => void) => {
  window.addEventListener("mp-theme-change", callback);
  return () => window.removeEventListener("mp-theme-change", callback);
};
/** Shared two-level choice menu. Selection is independent of hover/focus. */
function SettingsChoice({
  id,
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <Menu.Sub>
      <Menu.SubTrigger
        id={id}
        className="settings-item"
        disabled={disabled}
        onPointerLeave={(event) => {
          // A fast pointer can enter the portalled submenu in one event.
          // Keep focus there instead of briefly returning it to the parent menu.
          const next = event.relatedTarget;
          if (
            next instanceof Element &&
            next.closest(`[data-settings-submenu="${id}"]`)
          )
            event.preventDefault();
        }}
      >
        {label}
        <span className="submenu-arrow">
          <Icon name="chevron" />
        </span>
      </Menu.SubTrigger>
      <Menu.Portal>
        <Menu.SubContent
          className="settings-menu"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          data-settings-submenu={id}
        >
          <Menu.RadioGroup value={value} onValueChange={onChange}>
            {options.map((option) => (
              <Menu.RadioItem
                className="settings-item"
                value={option.value}
                key={option.value}
              >
                {option.label}
                <Menu.ItemIndicator className="select-check">
                  <Icon name="check" />
                </Menu.ItemIndicator>
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.SubContent>
      </Menu.Portal>
    </Menu.Sub>
  );
}
export function RoomSettings({
  onContext,
  contextDisabled,
  profile,
  onProfile,
  profiles,
}: {
  onContext?: () => void;
  contextDisabled: boolean;
  profile: string;
  onProfile?: (value: string) => void;
  profiles: { value: string; label: string }[];
}) {
  const theme = useSyncExternalStore(
    subscribe,
    () => window.mpTheme?.choice || "system",
  );
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <IconButton
          id="room-settings"
          icon="settings"
          label="Room settings"
          className="icon-only"
        />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          className="settings-menu"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          aria-label="Room settings"
        >
          {onProfile && (
            <SettingsChoice
              id="profile-menu"
              label="Interview"
              value={profile}
              onChange={onProfile}
              options={profiles}
              disabled={contextDisabled}
            />
          )}
          <SettingsChoice
            id="theme-choice"
            label="Appearance"
            value={theme}
            onChange={(v) => window.mpTheme.set(v)}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          {onContext && (
            <Menu.Item
              id="background-open"
              className="settings-item"
              disabled={contextDisabled}
              onSelect={() => {
                setTimeout(onContext, 0);
              }}
            >
              Company context
            </Menu.Item>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
