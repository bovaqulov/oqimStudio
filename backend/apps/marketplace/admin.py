from __future__ import annotations

from django.contrib import admin

from .models import MarketTemplate, TemplateReview


@admin.register(MarketTemplate)
class MarketTemplateAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "module_key", "author", "installs", "price", "is_published")
    list_filter = ("category", "module_key", "is_published")
    search_fields = ("name",)


@admin.register(TemplateReview)
class TemplateReviewAdmin(admin.ModelAdmin):
    list_display = ("template", "author_name", "rating", "created_at")
