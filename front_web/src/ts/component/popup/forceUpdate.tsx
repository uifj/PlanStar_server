import { Button, Error, Icon, Label, Title } from "Component";
import type * as I from "Interface";
import { desktop, type UpdateStatePayload } from "Lib/desktop";
import React, { forwardRef, useEffect, useState } from "react";

/**
 * Blocking modal shown when main broadcasts `ForceUpdateRequired` (forceUpdateGuard, Stage 6).
 * The renderer owns the UI, main only decides *whether* an update is mandatory.
 *
 * Deliberately inescapable: no cancel button, no escape binding, and the open() call site passes
 * `preventCloseByClick: true` so the dimmer does not dismiss it either. The only way out is a
 * successful update — matching the guard's contract that the shell keeps broadcasting until the
 * app is updated or closed.
 *
 * Styled by reusing the `popupConfirm` class through `param.className` at the open() call site.
 */
const PopupForceUpdate = forwardRef<{}, I.Popup>((props, ref) => {
	const { param } = props;
	const { data } = param;
	const [state, setState] = useState<UpdateStatePayload | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		// The bridge replays the latest state to late subscribers, so this also picks up a
		// download that main started before the popup mounted.
		const off = desktop.onUpdateStateChanged((next) => {
			setState(next);

			if (next.kind == "update-downloaded") {
				// The mandatory update is staged; finish the loop without another click.
				desktop.quitAndInstallUpdate();
			} else if (next.kind == "error") {
				setError(next.message || "");
			}
		});
		return () => off();
	}, []);

	const version = String(
		data.version || (state && (state as any).version) || "",
	);
	const releaseNotes = String(
		data.releaseNotes || (state && (state as any).releaseNotes) || "",
	);
	const kind = state ? state.kind : "";

	const onUpdateHandler = () => {
		setError("");

		if (kind == "update-downloaded") {
			desktop.quitAndInstallUpdate();
			return;
		}

		if (kind == "downloading" || kind == "installing") {
			return;
		}

		desktop.downloadUpdate().then((result) => {
			// `null` means the shell could not run the download (flag off, updater missing, web
			// mode). Surface it instead of leaving the user staring at a dead button.
			if (result === null && !desktop.isShell()) {
				setError(translate("popupForceUpdateErrorUnavailable"));
			}
		});
	};

	let button: any = null;
	let status = "";

	if (kind == "downloading") {
		const progress = Math.round(Number((state as any).progress) || 0);
		status = U.String.sprintf(
			translate("popupForceUpdateDownloading"),
			`${progress}%`,
		);
	} else if (kind == "installing") {
		status = translate("popupForceUpdateInstalling");
	}

	if (kind != "installing") {
		button = (
			<Button
				text={
					kind == "update-downloaded"
						? translate("popupForceUpdateRestart")
						: translate("popupForceUpdateButton")
				}
				color="accent"
				size={36}
				onClick={onUpdateHandler}
			/>
		);
	}

	return (
		<div className="wrap">
			<div className="iconWrapper">
				<Icon name="popup/header/update" size={56} />
			</div>

			<Title text={translate("popupForceUpdateTitle")} />
			<Label
				className="descr"
				text={U.String.sprintf(translate("popupForceUpdateText"), version)}
			/>

			{releaseNotes ? <Label className="descr" text={releaseNotes} /> : ""}
			{status ? <Label className="descr" text={status} /> : ""}

			<div className="buttons">{button}</div>

			<Error text={error} />
		</div>
	);
});

export default PopupForceUpdate;
