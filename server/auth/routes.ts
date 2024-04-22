import { Router } from 'express';
import type {
	B2BMagicLinksAuthenticateResponse,
	B2BMagicLinksDiscoveryAuthenticateResponse,
	B2BOAuthDiscoveryAuthenticateResponse,
} from 'stytch';
import {
	cookieOptions,
	exchangeIntermediateToken,
	getAuthenticatedUserInfo,
	loadStytch,
	stytchEnv,
} from './index.js';

export const auth = Router();

/**
 * OAuth discovery lets members use their Google or Microsoft accounts for auth.
 *
 * @see https://stytch.com/docs/b2b/guides/oauth/discovery
 */
auth.get('/discovery/:method', (req, res) => {
	const { method } = req.params;

	if (!['google', 'microsoft'].includes(method)) {
		throw new Error(`method ${method} is unsupported`);
	}

	const stytchApi = new URL(`${stytchEnv}.stytch.com`);

	stytchApi.pathname = `/v1/b2b/public/oauth/${method}/discovery/start`;
	stytchApi.searchParams.set(
		'public_token',
		process.env.STYTCH_PUBLIC_TOKEN ?? '',
	);

	res.redirect(stytchApi.toString());
});

/**
 * Magic links let members use their email for auth without the hassle of
 * managing passwords.
 *
 * @see https://stytch.com/docs/b2b/guides/magic-links/send-discover-eml
 */
auth.post('/discovery/email', (req, res) => {
	const stytch = loadStytch();
	const email_address = req.body.email_address;

	stytch.magicLinks.email.discovery.send({ email_address });

	res.status(200).json({ message: 'Please check your email' });
});

/**
 * NOTE: This app doesn’t implement it, but it’s possible to add a password
 * flow if you prefer that auth method.
 *
 * @see https://stytch.com/docs/b2b/guides/passwords/api
 */

/**
 * The redirect handler does a LOT of work in the auth flow. There are several
 * ways that members can authenticate. In this app, we implement handlers for
 * the magic link and OAuth discovery flows. Discovery allows each member to
 * choose the organization they want to log into.
 *
 * It’s also possible to use a custom URL for each organization if you don’t
 * want to use discovery. For more details, see the multi-tenancy docs:
 *
 * @see https://stytch.com/docs/b2b/guides/multi-tenancy
 */
auth.get('/redirect', async (req, res) => {
	const stytch = loadStytch();

	const type = req.query.stytch_token_type;
	const token = req.query.token as string;

	let response:
		| B2BOAuthDiscoveryAuthenticateResponse
		| B2BMagicLinksDiscoveryAuthenticateResponse
		| B2BMagicLinksAuthenticateResponse;

	if (type === 'discovery_oauth') {
		response = await stytch.oauth.discovery.authenticate({
			discovery_oauth_token: token,
		});
	} else if (type === 'discovery') {
		response = await stytch.magicLinks.discovery.authenticate({
			discovery_magic_links_token: token,
		});
	} else if (type === 'multi_tenant_magic_links') { // processes Email Magic Links and Invite Email Magic Links
		response = await stytch.magicLinks.authenticate({
			magic_links_token: token,
		});

		res.cookie('stytch_session', response.session_token, cookieOptions);

		res.redirect(307, new URL('/dashboard', process.env.APP_URL).toString());
		return;
	} else {
		// if we get here, the request is unsupported so we return an error
		res.status(500).send(`unknown token type ${req.body.stytch_token_type}`);
		return;
	}

	const orgs = response.discovered_organizations;
	const intermediateToken = response.intermediate_session_token;

	const discovered_orgs = orgs.map((org) => {
		return {
			id: org.organization?.organization_id,
			name: org.organization?.organization_name,
			status: org.membership?.type,
		};
	});

	res.cookie('intermediate_token', intermediateToken, cookieOptions);
	res.cookie('discovered_orgs', JSON.stringify(discovered_orgs), cookieOptions);

	/*
	 * Now that we’ve discovered the member’s available orgs, we need to show them
	 * UI so they can choose which one they want to auth into. Redirect to a page
	 * that shows existing organizations (if any) and an option to create a new
	 * organization.
	 */
	res.redirect(
		307,
		new URL('/dashboard/select-team', process.env.APP_URL).toString(),
	);
});

/**
 * Once the member selects an organization, create a full session for them.
 * Check the definition of {@link exchangeIntermediateToken} for details.
 */
auth.get('/select-team', async (req, res) => {
	await exchangeIntermediateToken({
		res,
		intermediate_session_token: req.cookies.intermediate_token,
		organization_id: req.query.org_id as string,
	});

	res.redirect(303, new URL('/dashboard', process.env.APP_URL).toString());
});

/**
 * Stytch is organization-first, but it’s still possible for a member to switch
 * organizations without needing to auth again. This is done by exchanging their
 * current session (tied to the current org ID) for a new one that’s tied to the
 * other org ID.
 *
 * @see https://stytch.com/docs/b2b/api/exchange-session
 */
auth.post('/switch-team', async (req, res) => {
	if (req.body.organization_id === 'new') {
		res.redirect('/auth/logout');
		return;
	}

	const stytch = loadStytch();

	const result = await stytch.sessions.exchange({
		organization_id: req.body.organization_id,
		session_token: req.cookies.stytch_session,
	});

	// if there’s a problem (e.g. auth methods don’t match) we need to auth again
	if (result.status_code !== 200) {
		res.redirect('/auth/logout');
		return;
	}

	res.cookie('stytch_session', result.session_token, cookieOptions);

	res.redirect(303, new URL('/dashboard', process.env.APP_URL).toString());
});

/**
 * If the user chooses to create a new organization in the discovery flow, we
 * handle that here. This will create the new account and exchange the
 * intermediate token at the same time.
 *
 * @see https://stytch.com/docs/b2b/api/create-organization-via-discovery
 */
auth.post('/register', async (req, res) => {
	const token = req.cookies.intermediate_token;
	const organization = req.body.organization;
	const slug = organization
		.trim()
		.toLowerCase()
		.replace(/[\s+~\/]/g, '-')
		.replace(/[().`,%·'"!?¿:@*]/g, '');

	const stytch = loadStytch();

	const result = await stytch.discovery.organizations.create({
		intermediate_session_token: token,
		organization_name: organization,
		organization_slug: slug,
	});

	const organization_id = result.organization?.organization_id;
	const member_id = result.member.member_id;

	if (result.status_code !== 200 || typeof organization_id !== 'string') {
		throw new Error('Unable to create organization');
	}

	res.clearCookie('intermediate_token');

	// Set cookies needed for the Stytch SDK's
	// https://stytch.com/docs/b2b/sdks/javascript-sdk/resources/cookies-and-session-management
	res.cookie('stytch_session', result.session_token, cookieOptions);

	res.redirect(303, new URL('/dashboard', process.env.APP_URL).toString());
});

/**
 * Revoke all sessions for the current member and clear cookies.
 *
 * @see https://stytch.com/docs/b2b/api/revoke-session
 */
auth.get('/logout', async (req, res) => {
	const stytch = loadStytch();

	const { member } = await getAuthenticatedUserInfo({ req })

	stytch.sessions.revoke({ member_id: member!.member_id });

	res.clearCookie('stytch_session');

	res.redirect(new URL('/dashboard/login', process.env.APP_URL).toString());
});
