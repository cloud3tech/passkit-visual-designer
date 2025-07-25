import * as React from "react";
import {
	BrowserRouter as Router,
	Switch,
	Route,
	Redirect,
	useLocation,
	useHistory,
} from "react-router-dom";
import thunk from "redux-thunk";
import localForage from "localforage";
import { Provider } from "react-redux";
import { composeWithDevTools } from "redux-devtools-extension";
import PassSelector from "../PassSelector";
import { createStore, applyMiddleware } from "redux";
import Configurator from "../Configurator";
import * as Store from "@pkvd/store";
import RecentSelector from "../RecentSelector";
import LoaderFace from "../Loader";
import { CSSTransition, SwitchTransition } from "react-transition-group";
import { PassMediaProps, PassMixedProps } from "@pkvd/pass";
import { v1 as uuid } from "uuid";

export interface StateLookalike {
	pass: Partial<PassMixedProps>;
	translations: {
		[language: string]: [placeholder: string, value: string][];
	};
	media: {
		[language: string]: [fileName: string, buffer: ArrayBuffer][];
	};
	projectOptions: {
		title: string;
	};
}

// Webpack valorized
declare const __DEV__: boolean;

/**
 * Loading time is used to sync loading
 * with animations.
 */

const LOADING_TIME_MS = 1500;

const store = createStore(
	Store.reducers,
	Store.initialState,
	composeWithDevTools(
		applyMiddleware(
			Store.middlewares.CreationMiddleware,
			Store.middlewares.CollectionEditUrlMiddleware,
			Store.middlewares.CollectionActivationMiddleware,
			Store.middlewares.PurgeMiddleware
		),
		applyMiddleware(thunk),
		/** Order here is important. We want to execute next mid after thunks */
		applyMiddleware(Store.middlewares.LocalForageSaveMiddleware)
	)
);

/**
 * A container that allows us to have
 * a loading overlay with transition
 * and to use history and location hooks
 * in App component below
 */

export function PassEditorApp() {
	const [isLoading, setLoading] = React.useState(true);

	return (
		<Provider store={store}>
			<Router>
				<CSSTransition mountOnEnter unmountOnExit in={isLoading} timeout={500}>
					<LoaderFace />
				</CSSTransition>
				<App setLoading={setLoading} />
			</Router>
		</Provider>
	);
}

interface Props {
	setLoading(state: React.SetStateAction<boolean>): void;
}

function App(props: Props): JSX.Element {
	const [forageData, setForageData] = React.useState<Store.Forage.ForageStructure>();

	const history = useHistory();
	const location = useLocation();

	const wrapLoading = React.useCallback(
		async (phase: Function, minTimeBeforeExecution?: number, minTimeBeforeCompletion?: number) => {
			props.setLoading(true);

			await Promise.all([
				minTimeBeforeCompletion
					? createDelayedPromise(minTimeBeforeCompletion, null)
					: Promise.resolve(),
				minTimeBeforeExecution
					? createDelayedPromise(minTimeBeforeExecution, phase)
					: Promise.resolve(phase()),
			]);

			props.setLoading(false);
		},
		[]
	);

	const changePathWithLoading = React.useCallback((path: string, preloadCallback?: Function) => {
		wrapLoading(
			() => {
				preloadCallback?.();
				history.push(path);
			},
			null,
			LOADING_TIME_MS
		);
	}, []);

	const refreshForageCallback = React.useCallback(async () => {
		const slices: (keyof Store.Forage.ForageStructure)[] = ["projects"];

		const data = Object.assign(
			{},
			...(
				await Promise.all(
					slices.map((slice) =>
						localForage.getItem<Store.Forage.ForageStructure[typeof slice]>(slice)
					)
				)
			).map((data, index) => ({ [slices[index]]: data }))
		) as Store.Forage.ForageStructure;

		setForageData(data);
	}, []);

	const initializeStore = React.useCallback(
		async (snapshot: Store.State) => {
			sessionStorage.clear();
			/**
			 * Trick to show loader, so if this takes a bit of time,
			 * UI doesn't seems to be stuck.
			 * @TODO Actually, what would be better is not firing Init until
			 * we are not sure that resolutions URLs have been generated.
			 * For the moment we are using the same normal flow, through
			 * middlewares.
			 */

			store.dispatch(Store.Forage.Init(snapshot));

			/** Iterating through medias so we can create and set URLs for array buffers */

			const availableMediaLanguages = Object.entries(snapshot.media);

			for (
				let i = availableMediaLanguages.length, localized: typeof availableMediaLanguages[0];
				(localized = availableMediaLanguages[--i]);

			) {
				const [language, mediaSet] = localized;
				const mediaEntries = Object.entries(mediaSet) as [
					keyof PassMediaProps,
					Store.CollectionSet
				][];

				for (
					let i = mediaEntries.length, mediaEntry: typeof mediaEntries[0];
					(mediaEntry = mediaEntries[--i]);

				) {
					const [mediaName, collectionSet] = mediaEntry;
					const collectionEntries = Object.entries(collectionSet.collections);

					for (
						let i = collectionEntries.length, collectionEntry: typeof collectionEntries[0];
						(collectionEntry = collectionEntries[--i]);

					) {
						const [collectionID, collection] = collectionEntry;

						store.dispatch(
							Store.Media.EditCollection(mediaName, language, collectionID, collection)
						);
					}
				}
			}
		},
		[forageData?.projects]
	);

	const initializeStoreByProjectID = React.useCallback(
		(projectID: string) => {
			if (!forageData.projects[projectID]) {
				throw `No project with id ${projectID}. Is there any kind of caching happening?`;
			}

			const { snapshot } = forageData.projects[projectID];

			return initializeStore(snapshot);
		},
		[initializeStore]
	);

	const createProjectFromArchive = React.useCallback(
		(data: StateLookalike) => {
			wrapLoading(
				() => {
					const translations = Object.entries(
						data.translations
					).reduce<Store.LocalizedTranslationsGroup>(
						(acc, [lang, contents]) => ({
							...acc,
							[lang]: {
								enabled: true,
								translations: contents.reduce(
									(acc, content) => ({
										...acc,
										[uuid()]: content,
									}),
									{}
								),
							},
						}),
						{}
					);

					const mediaNameCollIDMap = new Map();

					const media = Object.entries(data.media).reduce<Store.LocalizedMediaGroup>(
						(acc, [lang, contents]) => {
							return {
								...acc,
								[lang]: contents.reduce((acc, [fileName, buffer]) => {
									const mediaNameWithoutExtOrResolution = fileName.replace(
										/(@\dx)?\.(.+)$/,
										""
									) as keyof PassMediaProps;
									let collectionID: string = mediaNameCollIDMap.get(
										mediaNameWithoutExtOrResolution
									);

									if (!collectionID) {
										collectionID = uuid();
										mediaNameCollIDMap.set(mediaNameWithoutExtOrResolution, collectionID);
									}

									const resolutionID = uuid();
									const collectionSet = {
										activeCollectionID: collectionID,
										enabled: true,
										collections: {
											[collectionID]: {
												name: `Imported Collection ${mediaNameWithoutExtOrResolution}`,
												resolutions: {
													...(acc[mediaNameWithoutExtOrResolution]?.["collections"]?.[collectionID]
														?.resolutions || null),
													[resolutionID]: {
														name: fileName,
														content: buffer,
													},
												},
											},
										},
									};

									return {
										...acc,
										[mediaNameWithoutExtOrResolution]: collectionSet,
									};
								}, {}),
							};
						},
						{}
					);

					const snapshot: Store.State = Object.assign({}, Store.initialState, {
						pass: data.pass,
						translations,
						projectOptions: {
							title: data.projectOptions.title,
							activeMediaLanguage: "default",
						},
						media,
					});

					initializeStore(snapshot);
					history.push("/creator");
				},
				LOADING_TIME_MS,
				LOADING_TIME_MS
			);
		},
		[initializeStore, history]
	);

	React.useEffect(() => {
		/**
		 * Removing previously created records.
		 * Otherwise we might occour in orphan blob
		 * urls when the page is reloaded or
		 * restored.
		 */

		sessionStorage.clear();
		wrapLoading(refreshForageCallback, null, LOADING_TIME_MS);
	}, []);

	React.useEffect(() => {
		const unlisten = history.listen(async (nextLocation, action) => {
			if (action === "POP") {
				if (location.pathname === "/creator" && nextLocation.pathname === "/select") {
					history.replace("/");
				}

				wrapLoading(
					() => {
						store.dispatch(Store.Forage.Reset());
					},
					LOADING_TIME_MS,
					LOADING_TIME_MS
				);
			}
		});

		return () => {
			/**
			 * This is a side effect of using hooks.
			 * What we need to achieve is to use location in the listener.
			 * So to avoid retentions and get the latest location from its
			 * hook we need to refresh the effect.
			 * When hook is refreshed, listener get removed and we don't
			 * receive the History POP notification because it is too late.
			 * Therefore we delay the call to unlisten(), so we don't create
			 * anyway several listeners and we still receive it.
			 */

			setTimeout(unlisten, 0);
		};
	}, [location]);

	return (
		<SwitchTransition>
			<CSSTransition
				// Fallback here is needed to avoid weird animation looping (https://git.io/Jvbpa)
				key={location.key || ""}
				timeout={LOADING_TIME_MS}
				mountOnEnter
			>
				<Switch location={location}>
					<Route path="/" exact>
						<RecentSelector
							recentProjects={forageData?.projects ?? {}}
							requestForageDataRequest={refreshForageCallback}
							initStore={initializeStoreByProjectID}
							pushHistory={changePathWithLoading}
							createProjectFromArchive={createProjectFromArchive}
						/>
					</Route>
					<Route path="/select">
						{() => {
							/**
							 * This condition is for startup. The navigation from
							 * /creation will be handled by history.listen above
							 */
							return !__DEV__ && history.action === "POP" ? (
								<Redirect to="/" />
							) : (
								<PassSelector pushHistory={changePathWithLoading} />
							);
						}}
					</Route>
					<Route path="/creator">
						{/** Let's play monopoly. You landed to /creator. Go to home without passing Go! */}
						{() =>
							!(__DEV__ || store.getState()?.pass?.kind) ? <Redirect to="/" /> : <Configurator />
						}
					</Route>
				</Switch>
			</CSSTransition>
		</SwitchTransition>
	);
}

function createDelayedPromise(timeout: number, execution?: Function) {
	return new Promise<void>((resolve) => {
		setTimeout(() => {
			execution?.();
			resolve();
		}, timeout);
	});
}

// Sample data

/*
const sampleData = {
	media: {
		logoText: "blablabla",
		headerFields: [
			{
				label: "Data",
				key: "departing_date",
				value: "10/04/1996",
			}, {
				label: "Ora",
				key: "departing_time",
				value: "10:30",
			}, {
				label: "test",
				key: "departing_time",
				value: "10:30",
			}
		],
		// BoardingPass
		primaryFields: [
			{
				key: "starting_point",
				value: "ARN",
				label: "stockholm-arlanda"
			}, {
				key: "finish_point",
				value: "CPH",
				label: "copenhagen t2"
			}
		],
		// Coupon
		// primaryFields: [
		// 	{
		// 		fieldKey: "starting_point",
		// 		value: "21,75 USD",
		// 		label: "remaining balance"
		// 	}
		// ],
		// Event Ticket
		// primaryFields: [
		// 	{
		// 		"fieldKey": "event",
		// 		"label": "EVENT",
		// 		"value": "The Beat Goes On"
		// 	}
		// ],
		auxiliaryFields: [
			{
				key: "passenger",
				label: "passeggero",
				value: "Alexander Patrick Cerutti"
			},
			{
				key: "flight",
				label: "n. volo",
				value: "FR1328"
			},
			{
				key: "seq",
				label: "sequenza",
				value: "8"
			}
		],
		// Primary Fields
		secondaryFields: [
			{
				"key": "gateClose",
				"label": "Il Gate Chiude",
				"dateStyle": PKDateStyle.None,
				"timeStyle": PKDateStyle.Short,
				"value": "09:20"
			},
			{
				"key": "queue",
				"label": "Fila",
				"value": "Priorità"
			},
			{
				"key": "seat",
				"label": "Posto*",
				"value": "16C"
			}
		],
		// Event Ticket
		// secondaryFields: [
		// 	{
		// 		"fieldKey": "loc",
		// 		"label": "LOCATION",
		// 		"value": "Moscone West"
		// 	}
		// ],
	}
};
*/
