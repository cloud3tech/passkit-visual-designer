import * as ReactDOM from "react-dom";
import * as React from "react";
import "./styles.less";
import { PassEditorApp } from "../App";
import localForage from "localforage";

localForage.config();

ReactDOM.render(<PassEditorApp />, document.getElementById("root"));
