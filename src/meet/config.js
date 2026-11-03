export function meetURL(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a Google Meet URL");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "meet.google.com" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new Error("Only https://meet.google.com meeting links are accepted");
  const match = url.pathname.match(
    /^\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})\/?$/,
  );
  if (!match) throw new Error("Expected a Meet code such as abc-defg-hij");
  return "https://meet.google.com/" + match[1];
}
export function options(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) throw new Error("Use named arguments");
    const key = argv[i].slice(2);
    if (["consent", "voice", "tone", "headless", "synthetic"].includes(key))
      args[key] = true;
    else args[key] = argv[++i];
  }
  if (!args.url) throw new Error("--url is required");
  args.url = meetURL(args.url);
  args.seconds = Number(args.seconds || 60);
  if (!Number.isInteger(args.seconds) || args.seconds < 5 || args.seconds > 600)
    throw new Error("--seconds must be 5–600");
  if (args.voice && !args.consent)
    throw new Error("--voice requires --consent from all participants");
  args.profile = args.profile || "speedrun-10";
  return args;
}
