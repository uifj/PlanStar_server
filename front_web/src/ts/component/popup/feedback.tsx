import { Button, Checkbox, Error, Label, Textarea, Title } from "Component";
import type * as I from "Interface";
import { desktop } from "Lib/desktop";
import React, { forwardRef, useEffect, useRef, useState } from "react";

/**
 * Feedback dialog opened when the shell broadcasts `OpenFeedbackDialog` (native menu →
 * main/feedback.ts → preload bridge → app.tsx subscription). Styled by reusing the
 * `popupSubmitReport` class through `param.className` at the open() call site.
 *
 * Submission goes through the typed facade: desktop → main persists the report (and optional
 * window screenshot) under `userData/feedback/`; in web mode electronMock keeps it in
 * localStorage. Either way the dialog reports success the same way.
 */
const PopupFeedback = forwardRef<{}, I.Popup>((props, ref) => {
	const { param, close } = props;
	const { data } = param;
	const textareaRef = useRef(null);
	const checkboxRef = useRef(null);
	const [error, setError] = useState("");
	const [sending, setSending] = useState(false);

	const onSubmitHandler = async () => {
		if (sending) {
			return;
		}

		const value = String(textareaRef.current?.getValue() || "").trim();
		if (!value) {
			setError(translate("popupFeedbackErrorEmpty"));
			return;
		}

		setSending(true);
		setError("");

		let png = "";
		let width = 0;
		let height = 0;

		if (checkboxRef.current?.getValue()) {
			const shot = await desktop.captureScreenshot();
			if (shot && !shot.unsupported && shot.png) {
				png = shot.png;
				width = shot.width;
				height = shot.height;
			}
		}

		const result = await desktop.submitFeedback({
			text: value,
			attachScreenshot: Boolean(png),
			png,
			width,
			height,
			locale: S.Common.interfaceLang,
			appVersion: String(U.Common.getElectron().version?.app || ""),
		});

		setSending(false);

		if (result && result.success) {
			analytics.event("ClickFeedbackSubmit", {
				type: desktop.isShell() ? "desktop" : "web",
			});
			Preview.toastShow({ text: translate("popupFeedbackSuccess") });
			close();
		} else {
			setError(
				U.String.sprintf(
					translate("popupFeedbackError"),
					String((result && result.error) || "unavailable"),
				),
			);
		}
	};

	const onCancelHandler = () => {
		close();
	};

	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	return (
		<div className="wrap">
			<Title text={translate("popupFeedbackTitle")} />
			<Label text={translate("popupFeedbackDescription")} />

			<div className="inputs">
				<Textarea
					ref={textareaRef}
					placeholder={translate("popupFeedbackPlaceholder")}
					rows={5}
					readonly={sending}
				/>
				<div
					className="checkboxWrapper"
					onClick={() => checkboxRef.current?.toggle()}
				>
					<Checkbox ref={checkboxRef} value={data.attachScreenshot !== false} />
					<Label text={translate("popupFeedbackAttachScreenshot")} />
				</div>
			</div>

			<div className="buttons">
				<Button
					text={
						sending
							? translate("popupFeedbackSending")
							: translate("popupFeedbackSubmit")
					}
					color="accent"
					size={36}
					className={sending ? "isDisabled" : ""}
					onClick={onSubmitHandler}
				/>
				<Button
					text={translate("commonCancel")}
					color="blank"
					size={36}
					onClick={onCancelHandler}
				/>
			</div>

			<Error text={error} />
		</div>
	);
});

export default PopupFeedback;
