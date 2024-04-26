/**
 * Why is this whole app jammed into a single file?
 * ================================================
 *
 * The short answer is: this is the part that you’ll (probably) delete when you
 * build your own app.
 *
 * This is the layout and logic for the demo. Aside from the usage of the auth
 * components, most of this is only here to provide a demo that’s more
 * interesting than a hello world.
 *
 * Once you’ve seen how the Stytch auth components are used, you can safely
 * remove all of this code and replace it with your own app.
 *
 * Important code to review:
 *
 *  - {@link OrgSwitcher} — component for listing the current member’s
 * 		organizations & allowing them to switch between them (or create new ones)
 *  - {@link RequireAuth} — a wrapper component that only displays its children
 * 		if a valid member session is detected
 */

import {
  StytchB2BProvider,
  useStytchB2BClient,
  useStytchIsAuthorized,
  useStytchMember,
  useStytchMemberSession,
} from "@stytch/react/b2b";
import { StytchB2BHeadlessClient } from "@stytch/vanilla-js/b2b/headless";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import React, { useEffect } from "react";
import {
  BrowserRouter,
  Link,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import logo from "../images/squircle-logo-purple.png";
import styles from "./app.module.css";
import * as Pages from "./components/pages";

/**
 * This component is a bare bones organization switcher that shows a list of
 * every organization the current member is part of and selects the one they’re
 * currently authed into.
 *
 * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/discovery
 */
const OrgSwitcher = () => {
  const { member } = useStytchMember();
  const { isPending, error, data } = useQuery({
    queryKey: ["stytch:organizations:list", member?.member_id],
    queryFn: () => {
      // load the current member’s organizations using the Stytch React SDK
      return stytchClient.discovery.organizations.list();
    },
    staleTime: 60_000,
  });

  if (isPending || error) {
    return null;
  }

  return (
    <form
      className={styles.orgSelector}
      action={new URL(
        "/auth/switch-team",
        import.meta.env.PUBLIC_API_URL,
      ).toString()}
      method="POST"
      onChange={(e) => {
        /*
         * To avoid a two-step process, submit the form immediately when a new
         * option is selected.
         */
        e.currentTarget.submit();
      }}
    >
      <select defaultValue={member?.organization_id} name="organization_id">
        <optgroup label="Your Teams">
          {data.discovered_organizations.map((team) => {
            const orgId = team.organization.organization_id;

            return (
              <option key={orgId} value={orgId}>
                {team.organization.organization_name}
              </option>
            );
          })}
        </optgroup>

        <optgroup label="Options">
          <option value="new">create a new team</option>
        </optgroup>
      </select>
    </form>
  );
};

/**
 * This component loads the current member session and will only display its
 * children if one is found.
 *
 * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/session-management#get-session
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, fromCache } = useStytchMemberSession();
  const navigate = useNavigate();
  let location = useLocation();

  useEffect(() => {
    // TODO: Remove temoprary timeout for session not being set immediately
    const timer = setTimeout(() => {
      if (!session) {
        navigate("/dashboard/login", {
          state: {
            from: location,
          },
          replace: true,
        });
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [fromCache, session]);

  return session ? children : null;
}

/**
 * This component has global layout, including the dashboard sidebar. Some of
 * this UI is only available to logged-in members, so we need to check for a
 * valid session before showing it.
 *
 * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/session-management#get-session
 */
const Layout = () => {
  const { session } = useStytchMemberSession();

  return (
    <main className={styles.dashboard}>
      <section className={styles.page}>
        <Outlet />
      </section>

      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <a href="/" rel="home">
            <img {...logo} alt="Squircle logo" width="36" height="36" />
            Squircle
          </a>
        </div>

        {session?.member_id ? (
          <>
            <OrgSwitcher />

            <h3>Dashboard</h3>
            <nav>
              <Link to="/dashboard">View all ideas &rarr;</Link>
              <Link to="/dashboard/add">Add Idea +</Link>
            </nav>

            <h3>Team</h3>
            <nav>
              <Link to="/dashboard/team">Team Members</Link>
              <Link to="/dashboard/team-settings">Team Settings</Link>
            </nav>

            <h3>Account</h3>
            <nav>
              <Link to="/dashboard/account">Account Settings</Link>
              <a
                href={new URL(
                  "/auth/logout",
                  import.meta.env.PUBLIC_API_URL,
                ).toString()}
              >
                Log Out
              </a>
            </nav>
          </>
        ) : null}
      </aside>
    </main>
  );
};

const LoginLayout = () => {
  return (
    <main className={styles.loginContainer}>
      <section className={styles.loginSection}>
        <Pages.Login />
      </section>
    </main>
  );
};

/**
 * For pages that are only available to authorized members, we wrap them in the
 * {@link RequireAuth} component.
 */
const DashboardHome = () => (
  <RequireAuth>
    <Pages.Home />
  </RequireAuth>
);

/**
 * If a page needs access to the current member’s details, the
 * {@link useStytchMember} hook provides current member data.
 *
 * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/members#get-member
 */
const DashboardAdd = () => {
  const { member } = useStytchMember();

  return (
    <RequireAuth>
      <Pages.AddIdea member={member} />
    </RequireAuth>
  );
};

/**
 * For more complicated and/or custom actions, you may need to access the
 * Stytch B2B client SDK directly. The {@link useStytchB2BClient} hook will
 * return the SDK client.
 *
 * If the UI allows members to perform actions that require specific roles,
 * use the {@link useStytchIsAuthorized} hook to verify that the current member
 * has the correct permissions.
 *
 * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/rbac#is-authorized
 */
const DashboardTeamMembers = () => {
  const stytch = useStytchB2BClient();
  const { session } = useStytchMemberSession();
  const invite = useStytchIsAuthorized("stytch.member", "create");

  const isMemberAdmin = (m: any) =>
    m.roles.some(
      (role: { role_id: string }) => role.role_id === "stytch_admin",
    );

  if (!session) {
    return null;
  }

  /*
   * This function is called inside a loop, so we curry it to use the current
   * member being looped over and return an event handler to update that
   * member’s assigned roles.
   */
  const updateMemberRole = async (member: any) => {
    const roles = new Set(member.roles);

    /**
     * @see https://stytch.com/docs/b2b/guides/rbac/role-assignment
     */
    if (isMemberAdmin(member)) {
      roles.delete("stytch_admin");
    } else {
      roles.add("stytch_admin");
    }

    /**
     * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/members#update-member
     */
    return stytch.organization.members.update({
      member_id: member.id,
      roles: [...roles.values()] as string[],
    });
  };

  /*
   * Allow members to invite new people to the organization via email.
   */
  const inviteNewMember = async (email: string) => {
    if (!invite.isAuthorized) {
      throw new Error("Unauthorized to invite new members");
    }

    /**
     * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/email-magic-links#invite
     */
    return await stytch.magicLinks.email.invite({
      email_address: email,
    });
  };

  return (
    <RequireAuth>
      <Pages.TeamMembers
        isAdmin={session.roles.includes("stytch_admin")}
        isAuthorizedToInvite={invite.isAuthorized}
        updateMemberRole={updateMemberRole}
        inviteNewMember={inviteNewMember}
      />
    </RequireAuth>
  );
};

const DashboardTeamSettings = () => {
  /**
   * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/rbac#is-authorized
   */
  const jit = useStytchIsAuthorized(
    "stytch.organization",
    "update.settings.sso-jit-provisioning",
  );
  const invites = useStytchIsAuthorized(
    "stytch.organization",
    "update.settings.email-invites",
  );
  const allowedDomains = useStytchIsAuthorized(
    "stytch.organization",
    "update.settings.allowed-domains",
  );
  const allowedAuthMethods = useStytchIsAuthorized(
    "stytch.organization",
    "update.settings.allowed-auth-methods",
  );

  return (
    <RequireAuth>
      <Pages.TeamSettings
        isAuthorized={{
          jit: jit.isAuthorized,
          invites: invites.isAuthorized,
          allowedDomains: allowedDomains.isAuthorized,
          allowedAuthMethods: allowedAuthMethods.isAuthorized,
        }}
      />
    </RequireAuth>
  );
};

const DashboardAccount = () => (
  <RequireAuth>
    <Pages.Account />
  </RequireAuth>
);

const Router = () => {
  return (
    <Routes>
      <Route path="dashboard/login" element={<LoginLayout />} />
      <Route path="dashboard" element={<Layout />}>
        <Route index element={<DashboardHome />} />
        <Route path="add" element={<DashboardAdd />} />
        <Route path="team" element={<DashboardTeamMembers />} />
        <Route path="team-settings" element={<DashboardTeamSettings />} />
        <Route path="account" element={<DashboardAccount />} />

        <Route path="select-team" element={<Pages.SelectTeam />} />

        {/* for any other route, bounce to the login page */}
        <Route path="*" element={<Pages.Login />} />
      </Route>
    </Routes>
  );
};

/**
 * @see https://stytch.com/docs/b2b/sdks/javascript-sdk/installation
 */
const stytchClient = new StytchB2BHeadlessClient(
  import.meta.env.PUBLIC_STYTCH_TOKEN,
);
const queryClient = new QueryClient();

export const App = () => {
  return (
    <React.StrictMode>
      <StytchB2BProvider stytch={stytchClient}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Router />
          </BrowserRouter>
        </QueryClientProvider>
      </StytchB2BProvider>
    </React.StrictMode>
  );
};
