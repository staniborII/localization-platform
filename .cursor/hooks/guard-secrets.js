const { readStdin, respond } = require("./read-stdin");

const GIT_ADD = /\bgit\s+add\b/;
const FORBIDDEN = /(^|[\s"'`])(\.env\b|credentials|id_rsa|\.pem\b|[^\s"'`]+\.mp4)/i;

readStdin()
  .then((input) => {
    const command = input.command || "";
    if (GIT_ADD.test(command) && FORBIDDEN.test(command)) {
      respond({
        permission: "deny",
        user_message: "That git add includes a secret file or a sample video.",
        agent_message: "Blocked git add of .env, credentials, or an mp4. Sample videos and secrets stay untracked.",
      });
      return;
    }
    respond({ permission: "allow" });
  })
  .catch(() => {
    respond({
      permission: "deny",
      user_message: "The secrets hook could not read the command.",
      agent_message: "guard-secrets failed closed.",
    });
    process.exit(2);
  });
