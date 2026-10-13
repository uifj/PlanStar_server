import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Alert } from "@/shared/components/Alert";
import { type VanDetail, vanTypes } from "@/shared/domain/vans/types";
import { useTranslation } from "@/shared/i18n";
import { useHostVanForm } from "../hooks/useHostVanForm";
import type { CreateHostVanRequest } from "../types";

interface HostVanFormProps {
	initialVan?: VanDetail;
	submitLabel: string;
	loading: boolean;
	error?: Error | null;
	successMessage?: string;
	onSubmit(van: CreateHostVanRequest): void;
}

export function HostVanForm({
	initialVan,
	submitLabel,
	loading,
	error,
	successMessage,
	onSubmit,
}: HostVanFormProps) {
	const { t } = useTranslation();
	const { formData, formError, handleChange, handleTypeChange, handleSubmit } =
		useHostVanForm({
			initialVan,
			onSubmit,
		});
	const alertMessage = formError
		? t(formError)
		: error?.message || successMessage || "";
	const alertVariant = formError || error ? "error" : "info";

	return (
		<form onSubmit={handleSubmit} className="grid gap-5">
			<div className="grid gap-4 md:grid-cols-2">
				<div className="grid gap-2">
					<label
						htmlFor="name"
						className="font-semibold text-foreground text-sm"
					>
						{t("host.form.name")}
					</label>
					<Input
						id="name"
						name="name"
						value={formData.name}
						onChange={handleChange}
						placeholder={t("host.form.namePlaceholder")}
						required
					/>
				</div>

				<div className="grid gap-2">
					<label
						htmlFor="location"
						className="font-semibold text-foreground text-sm"
					>
						{t("host.form.location")}
					</label>
					<Input
						id="location"
						name="location"
						value={formData.location}
						onChange={handleChange}
						placeholder={t("host.form.locationPlaceholder")}
						required
					/>
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<div className="grid gap-2">
					<label
						htmlFor="price"
						className="font-semibold text-foreground text-sm"
					>
						{t("host.form.dailyPrice")}
					</label>
					<Input
						id="price"
						name="price"
						type="number"
						min="1"
						value={formData.price}
						onChange={handleChange}
						placeholder="124"
						required
					/>
				</div>

				<div className="grid gap-2">
					<label
						htmlFor="sleeps"
						className="font-semibold text-foreground text-sm"
					>
						{t("host.form.sleeps")}
					</label>
					<Input
						id="sleeps"
						name="sleeps"
						type="number"
						min="1"
						value={formData.sleeps}
						onChange={handleChange}
						placeholder="2"
						required
					/>
				</div>

				<div className="grid gap-2">
					<label
						htmlFor="type"
						className="font-semibold text-foreground text-sm"
					>
						{t("host.form.type")}
					</label>
					<Select value={formData.type} onValueChange={handleTypeChange}>
						<SelectTrigger id="type" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{vanTypes.map((type) => (
								<SelectItem key={type} value={type}>
									{type}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="grid gap-2">
				<label
					htmlFor="imageUrl"
					className="font-semibold text-foreground text-sm"
				>
					{t("host.form.imageUrl")}
				</label>
				<Input
					id="imageUrl"
					name="imageUrl"
					type="url"
					value={formData.imageUrl}
					onChange={handleChange}
					placeholder="https://example.com/van.jpg"
					required
				/>
			</div>

			<div className="grid gap-2">
				<label
					htmlFor="description"
					className="font-semibold text-foreground text-sm"
				>
					{t("host.form.description")}
				</label>
				<Textarea
					id="description"
					name="description"
					value={formData.description}
					onChange={handleChange}
					rows={5}
					placeholder={t("host.form.descriptionPlaceholder")}
					className="resize-none"
					required
				/>
			</div>

			<div className="grid gap-2">
				<label
					htmlFor="amenities"
					className="font-semibold text-foreground text-sm"
				>
					{t("host.form.amenities")}
				</label>
				<Input
					id="amenities"
					name="amenities"
					value={formData.amenities}
					onChange={handleChange}
					placeholder={t("host.form.amenitiesPlaceholder")}
					required
				/>
				<p className="font-medium text-muted-foreground text-sm">
					{t("host.form.amenitiesHint")}
				</p>
			</div>

			<div className="grid gap-4">
				<Button type="submit" disabled={loading} className="sm:w-fit">
					{loading ? t("host.form.saving") : submitLabel}
				</Button>

				{alertMessage ? (
					<Alert variant={alertVariant}>{alertMessage}</Alert>
				) : null}
			</div>
		</form>
	);
}
