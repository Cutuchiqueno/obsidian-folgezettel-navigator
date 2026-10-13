import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{ ignores: ["main.js"] },
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["*.mjs"],
				},
			},
		},
		rules: {
			// "Folgezettel" is the name of the method, and a German noun: it keeps its capital.
			// `enforceCamelCaseLower` restates the recommended config's option, which this replaces.
			"obsidianmd/ui/sentence-case": ["warn", { enforceCamelCaseLower: true, ignoreWords: ["Folgezettel"] }],
		},
	},
	{
		// The build scripts run under Node, never inside Obsidian.
		files: ["esbuild.config.mjs", "version-bump.mjs"],
		languageOptions: { globals: { process: "readonly" } },
		rules: { "obsidianmd/no-nodejs-modules": "off" },
	},
]);
