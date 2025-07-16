import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import typescript from "@rollup/plugin-typescript";
import peerDepsExternal from "rollup-plugin-peer-deps-external";
import postcss from "rollup-plugin-postcss";
import handlebars from "rollup-plugin-handlebars-plus";

export default {
	input: "src/index.ts",
	output: [
		{
			file: "dist/index.js",
			format: "cjs",
			exports: "named",
			sourcemap: true,
		},
		{
			file: "dist/index.es.js",
			format: "esm",
			sourcemap: true,
		},
	],
	plugins: [
		peerDepsExternal(),
		resolve(),
		commonjs(),
		postcss(),
		typescript({ tsconfig: "./tsconfig.json" }),
		babel({
			babelHelpers: "bundled",
			exclude: "node_modules/**",
			presets: ["@babel/preset-react"],
		}),
		handlebars({
			include: "**/*.hbs",
			handlebars: {
				options: {
					knownHelpersOnly: false,
				},
			},
		}),
	],
};
