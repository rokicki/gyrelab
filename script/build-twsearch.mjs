// Builds the native twsearch in the submodule, for solving natively
// (twsearch --serve) and for the tests that check their answers against it.
// Needs a C++ compiler.
//
//    bun run build-twsearch
import { execFileSync } from "node:child_process";
import { checkTwsearchSubmodule, twsearchDir } from "./twsearch-submodule.mjs";

checkTwsearchSubmodule();
execFileSync("make", ["-C", twsearchDir.pathname, "build"], { stdio: "inherit" });
console.log("Built twsearch/build/bin/twsearch");
