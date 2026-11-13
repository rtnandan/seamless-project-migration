import { createFileRoute, redirect } from "@tanstack/react-router";

// The old Replies page now lives in the Inbox.
export const Route = createFileRoute("/_authenticated/replies")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox", replace: true });
  },
});
