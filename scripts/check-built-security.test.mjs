import { expect, test } from "bun:test"
import * as securityCheck from "./check-built-security.mjs"

test("synchronizes the generated hashes in both CSP sources", () => {
	const result = securityCheck.synchronizeCspSources?.({
		siteSource: `const inlineScriptHashes = [
	'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
];
`,
		headersSource: `/*
Content-Security-Policy: script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; object-src 'none'
*/
`,
		contentSecurityPolicy:
			"script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; object-src 'none'",
		hashes: ["BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="],
	})

	expect(result).toEqual({
		siteSource: `const inlineScriptHashes = [
	'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
];
`,
		headersSource: `/*
	Content-Security-Policy: script-src 'self' 'sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='; object-src 'none'
*/
`,
		contentSecurityPolicy:
			"script-src 'self' 'sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='; object-src 'none'",
	})
})

test("refuses to overwrite a CSP header that has drifted from site config", () => {
	expect(() =>
		securityCheck.synchronizeCspSources?.({
			siteSource: `const inlineScriptHashes = [
	'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
];
`,
			headersSource: `/*
	Content-Security-Policy: default-src 'none'
*/
`,
			contentSecurityPolicy:
				"script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; object-src 'none'",
			hashes: ["BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="],
		}),
	).toThrow(
		"public/_headers must contain exactly the configured Content-Security-Policy",
	)
})

test("uses the hash array line ending when the source mixes LF and CRLF", () => {
	const synchronize = () =>
		securityCheck.synchronizeCspSources({
			siteSource:
				"const inlineScriptHashes = [\n\t'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',\n];\nconst value = true;\r\n",
			headersSource:
				"Content-Security-Policy: script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='",
			contentSecurityPolicy:
				"script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='",
			hashes: ["BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="],
		})

	expect(synchronize).not.toThrow()
	expect(synchronize().siteSource).toBe(
		"const inlineScriptHashes = [\n\t'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',\n];\nconst value = true;\r\n",
	)
})

test("refuses to overwrite a non-literal hash array", () => {
	expect(() =>
		securityCheck.synchronizeCspSources({
			siteSource: "const inlineScriptHashes = [\n\tgetHashes(),\n];\n",
			headersSource: "Content-Security-Policy: script-src 'self'",
			contentSecurityPolicy: "script-src 'self'",
			hashes: ["BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB="],
		}),
	).toThrow(
		"src/config/site.js must contain exactly one literal inlineScriptHashes array",
	)
})
