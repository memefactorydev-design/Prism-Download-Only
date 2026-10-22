import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/node-only deps used by the publish subsystem (FTP/SFTP) must not be
  // bundled by Turbopack — keep them as runtime requires on the server.
  serverExternalPackages: [
    "ssh2",
    "ssh2-sftp-client",
    "basic-ftp",
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@libsql/client",
    "@prisma/adapter-libsql",
  ],
};

export default nextConfig;
