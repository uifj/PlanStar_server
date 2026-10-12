import { FaChevronDown } from "react-icons/fa6";
import { Alert } from "@/shared/components/Alert";
import { Input } from "@/shared/components/Input";
import { type VanDetail, vanTypes } from "@/shared/domain/vans/types";
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
	const { formData, formError, handleChange, handleSubmit } = useHostVanForm({
		initialVan,
		onSubmit,
	});
	const alertMessage = formError || error?.message || successMessage || "";
	const alertVariant = formError || error ? "error" : "info";

	return (
		<form onSubmit={handleSubmit} className="grid gap-5">
			<div className="grid gap-4 md:grid-cols-2">
				<div className="grid gap-2">
					<label htmlFor="name" className="font-semibold text-ink text-sm">
						Name
					</label>
					<Input
						id="name"
						name="name"
						value={formData.name}
						onChange={handleChange}
						placeholder="Sierra Weekender"
						required
					/>
				</div>

				<div className="grid gap-2">
					<label htmlFor="location" className="font-semibold text-ink text-sm">
						Location
					</label>
					<Input
						id="location"
						name="location"
						value={formData.location}
						onChange={handleChange}
						placeholder="Mammoth Lakes, CA"
						required
					/>
				</div>
			</div>

			<div className="grid gap-4 md:grid-cols-3">
				<div className="grid gap-2">
					<label htmlFor="price" className="font-semibold text-ink text-sm">
						Daily price
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
					<label htmlFor="sleeps" className="font-semibold text-ink text-sm">
						Sleeps
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
					<label htmlFor="type" className="font-semibold text-ink text-sm">
						Type
					</label>
					<div className="relative">
						<select
							id="type"
							name="type"
							value={formData.type}
							onChange={handleChange}
							className="w-full appearance-none rounded-lg border border-line bg-surface py-3 pr-12 pl-4 font-medium text-base text-ink shadow-sm outline-none transition-colors focus:border-clay"
						>
							{vanTypes.map((type) => (
								<option key={type} value={type}>
									{type}
								</option>
							))}
						</select>
						<FaChevronDown className="pointer-events-none absolute top-1/2 right-4 size-3 -translate-y-1/2 text-muted" />
					</div>
				</div>
			</div>

			<div className="grid gap-2">
				<label htmlFor="imageUrl" className="font-semibold text-ink text-sm">
					Image URL
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
				<label htmlFor="description" className="font-semibold text-ink text-sm">
					Description
				</label>
				<textarea
					id="description"
					name="description"
					value={formData.description}
					onChange={handleChange}
					rows={5}
					placeholder="Describe the van, setup, and best kind of trip."
					className="resize-none rounded-lg border border-line bg-surface px-4 py-3 font-medium text-base text-ink shadow-sm outline-none transition-colors placeholder:text-soft focus:border-clay"
					required
				/>
			</div>

			<div className="grid gap-2">
				<label htmlFor="amenities" className="font-semibold text-ink text-sm">
					Amenities
				</label>
				<Input
					id="amenities"
					name="amenities"
					value={formData.amenities}
					onChange={handleChange}
					placeholder="Solar, Camp Stove, Gear Storage"
					required
				/>
				<p className="font-medium text-muted text-sm">
					Separate amenities with commas.
				</p>
			</div>

			<div className="grid gap-4">
				<button
					type="submit"
					disabled={loading}
					className="w-full rounded-lg bg-clay px-6 py-3 font-bold text-surface transition-colors hover:bg-clay-dark active:scale-95 disabled:bg-line disabled:text-muted sm:w-fit"
				>
					{loading ? "Saving..." : submitLabel}
				</button>

				{alertMessage ? (
					<Alert variant={alertVariant}>{alertMessage}</Alert>
				) : null}
			</div>
		</form>
	);
}
