import { type ChangeEvent, type SubmitEvent, useState } from "react";
import type { VanDetail } from "@/shared/domain/vans/types";
import type { CreateHostVanRequest } from "../types";

interface HostVanFormData {
	name: string;
	price: string;
	description: string;
	imageUrl: string;
	type: CreateHostVanRequest["type"];
	location: string;
	sleeps: string;
	amenities: string;
}

interface UseHostVanFormOptions {
	initialVan?: VanDetail;
	onSubmit(van: CreateHostVanRequest): void;
}

const emptyFormData: HostVanFormData = {
	name: "",
	price: "",
	description: "",
	imageUrl: "",
	type: "simple",
	location: "",
	sleeps: "",
	amenities: "",
};

function getInitialFormData(initialVan?: VanDetail): HostVanFormData {
	if (!initialVan) {
		return emptyFormData;
	}

	return {
		name: initialVan.name,
		price: String(initialVan.price),
		description: initialVan.description,
		imageUrl: initialVan.imageUrl,
		type: initialVan.type,
		location: initialVan.location,
		sleeps: String(initialVan.sleeps),
		amenities: initialVan.amenities.join(", "),
	};
}

function getAmenities(value: string) {
	return value
		.split(",")
		.map((amenity) => amenity.trim())
		.filter(Boolean);
}

function getVanFromFormData(formData: HostVanFormData): CreateHostVanRequest {
	return {
		name: formData.name.trim(),
		price: Number(formData.price),
		description: formData.description.trim(),
		imageUrl: formData.imageUrl.trim(),
		type: formData.type,
		location: formData.location.trim(),
		sleeps: Number(formData.sleeps),
		amenities: getAmenities(formData.amenities),
	};
}

function validateVan(van: CreateHostVanRequest) {
	if (
		!van.name ||
		!van.description ||
		!van.imageUrl ||
		!van.location ||
		van.amenities.length === 0
	) {
		return "host.form.fillAllFields";
	}

	if (!Number.isFinite(van.price) || van.price <= 0) {
		return "host.form.invalidPrice";
	}

	if (!Number.isInteger(van.sleeps) || van.sleeps <= 0) {
		return "host.form.invalidSleeps";
	}

	return "";
}

export function useHostVanForm({
	initialVan,
	onSubmit,
}: UseHostVanFormOptions) {
	const [formData, setFormData] = useState(() =>
		getInitialFormData(initialVan),
	);
	const [formError, setFormError] = useState("");

	function handleChange(
		event: ChangeEvent<
			HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
		>,
	) {
		const { name, value } = event.target;

		setFormData((previousFormData) => ({
			...previousFormData,
			[name]: value,
		}));
	}

	function handleTypeChange(value: string) {
		setFormData((previousFormData) => ({
			...previousFormData,
			type: value as CreateHostVanRequest["type"],
		}));
	}

	function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();

		const van = getVanFromFormData(formData);
		const validationMessage = validateVan(van);

		if (validationMessage) {
			setFormError(validationMessage);
			return;
		}

		setFormError("");
		onSubmit(van);
	}

	return {
		formData,
		formError,
		handleChange,
		handleTypeChange,
		handleSubmit,
	};
}
